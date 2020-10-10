'use strict';

const Assert = require('@botsocket/bone/src/assert');
const Jade = require('@botsocket/jade');

const Ws = typeof window === 'undefined' ? require('ws') : WebSocket;       // eslint-disable-line no-undef

const internals = {
    opCodes: {                                // https://discord.com/developers/docs/topics/opcodes-and-status-codes#gateway-gateway-opcodes
        dispatch: 0,
        heartbeat: 1,
        identify: 2,
        resume: 6,
        reconnect: 7,
        invalidSession: 9,
        hello: 10,
        heartbeatAck: 11,
    },

    nonRecoverableCodes: [                    // https://discord.com/developers/docs/topics/opcodes-and-status-codes#gateway-gateway-close-event-codes
        4004,
        4010,
        4011,
        4013,
        4014,
    ],

    ratelimit: {                              // https://discord.com/developers/docs/topics/gateway#rate-limiting
        total: 120,
        timeout: 60 * 1000,
    },

    intents: {                                // https://discord.com/developers/docs/topics/gateway#list-of-intents
        GUILDS: 1 << 0,
        GUILD_MEMBERS: 1 << 1,
        GUILD_BANS: 1 << 2,
        GUILD_EMOJIS: 1 << 3,
        GUILD_INTEGRATIONS: 1 << 4,
        GUILD_WEBHOOKS: 1 << 5,
        GUILD_INVITES: 1 << 6,
        GUILD_VOICE_STATES: 1 << 7,
        GUILD_PRESENCES: 1 << 8,
        GUILD_MESSAGES: 1 << 9,
        GUILD_MESSAGE_REACTIONS: 1 << 10,
        GUILD_MESSAGE_TYPING: 1 << 11,
        DIRECT_MESSAGES: 1 << 12,
        DIRECT_MESSAGE_REACTIONS: 1 << 13,
        DIRECT_MESSAGE_TYPING: 1 << 14,
    },
};

internals.schema = Jade.object({
    token: Jade.str().required(),
    id: Jade.str(),
    shard: Jade.arr().ordered(Jade.num().required(), Jade.num().required()),
    intents: Jade.arr()
        .items(Jade.valid(...Object.keys(internals.intents), ...Object.values(internals.intents)).required())
        .single(),

    reconnect: Jade.obj({
        attempts: Jade.num().default(Infinity),
        delay: Jade.num().default(1000),
        maxDelay: Jade.num().min(Jade.ref('delay')).default(5000),
    })
        .allow(false)
        .default(),
})
    .required();

exports.client = function (url, options) {

    return new internals.Client(url, options);
};

internals.Client = class {
    constructor(url, options) {

        Assert(typeof url === 'string', 'Url must be a string');

        const settings = internals.schema.attempt(options);

        this.url = url;
        this.shard = settings.shard || [0, 1];                          // Gateway shard
        this.intents = internals.intents(settings.intents);             // Gateway intents
        delete settings.intents;
        delete settings.shard;

        this._ws = null;                                                // WebSocket connection

        this._settings = settings;                                      // Connection options

        // Event handlers

        this.onOpen = internals.noop;
        this.onClose = internals.noop;
        this.onError = (error) => console.log(error);
        this.onDispatch = internals.noop;

        // State

        this.id = settings.id;                                          // Session id (Allow resuming on instantiation)
        this._seq = null;                                               // Sequence number
        this._heartbeatTimer = null;                                    // Heartbeat interval
        this._heartbeatAcked = true;                                    // Whether the last heartbeat is acknowledged
        this._payloads = [];                                            // Pending payloads to be sent
        this._ratelimitTimer = null;                                    // Rate limit timeout
        this._reconnection = null;                                      // Reconnection state
        this._remainingPayloads = internals.ratelimit.total;            // Remaining payloads until rate limited
        this._reconnectionTimer = null;                                 // Reconnection timeout
    }

    connect() {

        Assert(!this._ws, 'Client is already connecting');
        Assert(!this._reconnection, 'Cannot start a client while it is attempting to reconnect');

        const reconnect = this._settings.reconnect;
        if (reconnect !== false) {                                                                  // Defaults to true
            this._reconnection = { wait: 0, attempts: reconnect.attempts };
        }

        return new Promise((resolve, reject) => {

            this._connect((error) => {

                if (error) {
                    return reject(error);
                }

                return resolve();
            });
        });
    }

    disconnect() {

        return new Promise((resolve) => {

            this._disconnect(resolve);
        });
    }

    _connect(callback) {

        const ws = new Ws(this.url);
        this._ws = ws;

        const finalize = (error) => {

            if (callback) {
                const holder = callback;
                callback = null;
                return holder(error);
            }

            if (error) {
                this.onError(error);
            }
        };

        // Event handlers

        const onError = (error) => {

            finalize(error);
            this._reconnect();
        };

        const onMessage = (message) => {

            this._onMessage(message, finalize);
        };

        const onClose = (code, reason) => {

            this._reconnect(code, reason, finalize);
        };

        // Use compatible API with the browser

        ws.onopen = this.onOpen;
        ws.onerror = onError;
        ws.onmessage = onMessage;
        ws.onclose = onClose;
    }

    _cleanup(code) {

        // Already cleaned up

        if (!this._ws) {
            return;
        }

        const ws = this._ws;
        this._ws = null;

        ws.close(code);

        ws.onopen = null;
        ws.onerror = null;
        ws.onmessage = null;
        ws.onclose = null;

        this.id = null;
        this._seq = null;
        this._heartbeatAcked = true;

        clearInterval(this._heartbeatTimer);
        this._heartbeatTimer = null;

        this._payloads = [];
        this._remainingPayloads = internals.ratelimit.total;

        clearInterval(this._ratelimitTimer);
        this._ratelimitTimer = null;
    }

    _reconnect(code, reason, finalize) {

        reason = reason || 'Unknown reason';

        // Trigger event

        this.onClose(code, reason);

        // Clean up

        this._cleanup(code);

        // Check for non-recoverable codes

        if (internals.nonRecoverableCodes.includes(code)) {
            return finalize(new Error(code === 4004 ? 'Invalid token' : reason));
        }

        // Resolve disconnect()

        if (this._disconnectCallback) {
            const disconnectCallback = this._disconnectCallback;
            this._disconnectCallback = null;
            disconnectCallback();
        }

        // _disconnect() called

        if (!this._reconnection) {
            return;
        }

        if (!this._reconnection.attempts) {
            return finalize(new Error('Maximum reconnection attempts reached'));
        }

        const reconnection = this._reconnection;
        reconnection.attempts--;
        reconnection.wait += this._settings.reconnection.delay;

        const timeout = Math.min(reconnection.wait, this._settings.reconnection.maxDelay);

        this._reconnectionTimer = setTimeout(() => {

            this._connect();
        }, timeout);
    }

    _disconnect(callback) {

        this._reconnection = null;
        clearTimeout(this._reconnectionTimer);
        this._reconnectionTimer = null;

        if (!this._ws) {
            return callback();
        }

        if (callback) {
            this._disconnectCallback = callback;
        }


        this._ws.close();
    }

    _onMessage(message, callback) {

        // Parse message

        let payload;
        try {
            payload = JSON.parse(message.data);
        }
        catch (error) {
            return callback(new Error('Invalid JSON content'));
        }

        // Assign new sequence number

        if (payload.s) {
            this._seq = payload.s;
        }

        // Process opcodes

        // Hello

        if (payload.op === internals.opCodes.hello) {
            const heartbeatInterval = payload.d.heartbeat_interval;

            this._heartbeatTimer = setInterval(() => {

                this._beat();
            }, heartbeatInterval);

            return this._identify();
        }

        // Heartbeat

        if (payload.op === internals.opCodes.heartbeat) {
            return this._beat();
        }

        // Heartbeat acknowledge

        if (payload.op === internals.opCodes.heartbeatAck) {
            this._heartbeatAcked = true;
            return;
        }

        // Reconnection requested

        if (payload.op === internals.opCodes.reconnect) {
            return this._reconnect(4000);
        }

        // Invalid session

        if (payload.op === internals.opCodes.invalidSession) {
            const resumable = payload.d;

            if (resumable) {
                return this._identify();
            }

            return this._disconnect();
        }

        // Dispatch

        if (payload.op === internals.opCodes.dispatch) {
            const event = payload.t;

            if (event === 'READY') {
                this.id = payload.d.session_id;
                callback();
            }

            this.onDispatch(event, payload.d);
        }
    }

    _beat() {

        if (!this._heartbeatAcked) {
            return this._reconnect(4000);
        }

        this._heartbeatAcked = false;
        this._send({ op: internals.opCodes.heartbeat, d: this._seq });
    }

    _identify() {

        const token = this.client._settings.token;

        // Resume if possible

        if (this.id) {
            return this._send({
                op: internals.opCodes.resume,
                d: {
                    token,
                    session_id: this.id,                    // eslint-disable-line camelcase
                    seq: this._seq,
                },
            });
        }

        // Identify new session

        this._send({
            op: internals.opCodes.identify,
            shards: this.shard,
            intents: this.intents,
            d: {
                token,
                properties: {
                    $os: process.platform,
                    $browser: 'nebula',
                    $device: 'nebula',
                },
            },
        });
    }

    _send(payload) {

        this._payloads.push(payload);

        if (!this._ratelimitTimer) {
            const setupTimer = () => {

                this._ratelimitTimer = setTimeout(() => {

                    this._remainingPayloads = internals.ratelimit.total;

                    clearTimeout(this._ratelimitTimer);
                    this._processPendingPayloads();

                    setupTimer();
                }, internals.ratelimit.timeout);
            };

            setupTimer();
        }

        this._processPendingPayloads();
    }

    _processPendingPayloads() {

        while (this._remainingPayloads) {
            const payload = this._payloads.shift();

            if (!payload) {
                return;
            }

            this._remainingPayloads--;
            this._ws.send(JSON.stringify(payload));
        }
    }
};

internals.noop = () => { };

internals.intents = function (intents) {

    let finalIntents;
    for (const intent of intents) {
        const value = typeof intent === 'string' ? internals.intents[intent] : intent;
        finalIntents |= value;
    }

    return finalIntents;
};
