'use strict';

const Assert = require('@botsocket/bone/src/assert');
const Jade = require('@botsocket/jade');

let Ws;

const internals = {
    isBrowser: typeof window !== 'undefined',

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

    reasons: {
        // WS default codes (https://github.com/Luka967/websocket-close-codes)

        1000: 'Normal closure',
        1001: 'Going away',
        1002: 'Protocol error',
        1003: 'Unsupported data',
        1004: 'Reserved',
        1005: 'No status received',
        1006: 'Abnormal closure',
        1007: 'Invalid frame payload data',
        1008: 'Policy violation',
        1009: 'Message too big',
        1010: 'Mandatory extension',
        1011: 'Internal server error',
        1015: 'TLS handshake',

        // Discord application codes (https://discord.com/developers/docs/topics/opcodes-and-status-codes#gateway-gateway-close-event-codes)

        4000: 'Unknown error',
        4001: 'Unknown opcode',
        4002: 'Decode error',
        4003: 'Not authenticated',
        4004: 'Invalid token',
        4005: 'Already authenticated',
        4007: 'Invalid seq',
        4008: 'Rate limited',
        4009: 'Session timed out',
        4010: 'Invalid shard',
        4011: 'Sharding required',
        4012: 'Invalid API version',
        4013: 'Invalid intent(s)',
        4014: 'Disallowed intent(s)',
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
        attempts: Jade.num().allow(Infinity).default(Infinity),
        delay: Jade.num().default(1000),
        maxDelay: Jade.num().min(Jade.ref('delay')).default(5000),
    })
        .allow(false)
        .default(),
})
    .required()
    .label('Options');

exports.client = function (url, options) {

    return new internals.Client(url, options);
};

internals.Client = class {
    constructor(url, options) {

        Ws = Ws || (internals.isBrowser ? WebSocket : require('ws'));   // eslint-disable-line no-undef

        Assert(typeof url === 'string', 'Url must be a string');

        const settings = internals.schema.attempt(options);

        this.url = url;
        this.shard = settings.shard || [0, 1];                          // Gateway shard
        this.intents = internals.resolveIntents(settings.intents);      // Gateway intents
        delete settings.intents;
        delete settings.shard;

        this._ws = null;                                                // WebSocket connection

        this._settings = settings;                                      // Connection options

        // Event handlers

        this.onDisconnect = internals.noop;
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
        this._disconnectCallback = null;                                // Disconnect callback
        this._closeExplanation = null;                                  // Close explanation
    }

    connect() {

        Assert(!this._ws, 'Client is already connecting');
        Assert(!this._reconnection, 'Cannot connect while the client is attempting to reconnect');

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

        ws.onopen = () => {

            ws.onopen = null;
        };

        ws.onerror = (event) => {

            finalize(event.error);
            ws.close();                                     // Call in case readyState not set to CLOSING internally to trigger reconnection
        };

        ws.onmessage = (event) => {

            this._onMessage(event.data, finalize);
        };

        ws.onclose = (event) => {

            const connectionClosed = Boolean(ws.onopen);            // Store before cleanup

            // Cleanup

            this._cleanup();

            // Stop reconnecting if connection closed (Error already handled in onerror)

            if (connectionClosed) {
                return;
            }

            const code = event.code;
            const reason = event.reason || internals.reasons[event.code];

            // Trigger event

            this.onDisconnect({ code, reason, explanation: this._closeExplanation });
            this._closeExplanation = null;

            // Check for non-recoverable codes

            if (internals.nonRecoverableCodes.includes(code)) {
                return finalize(new Error(reason));
            }

            // Resolve disconnect()

            if (this._disconnectCallback) {
                const disconnectCallback = this._disconnectCallback;
                this._disconnectCallback = null;
                return disconnectCallback();
            }

            this._reconnect(code, reason, finalize);
        };
    }

    _cleanup() {

        const ws = this._ws;
        this._ws = null;

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

        const reconnection = this._reconnection;

        if (!reconnection ||
            !reconnection.attempts) {

            this._disconnect();
            return finalize(new Error(`Connection failed with code ${code} - ${reason}`));
        }

        // Reconnect

        reconnection.attempts--;
        reconnection.wait += this._settings.reconnect.delay;

        const timeout = Math.min(reconnection.wait, this._settings.reconnect.maxDelay);

        this._reconnectionTimer = setTimeout(() => {

            this._connect(finalize);
        }, timeout);
    }

    _disconnect(callback) {

        // Terminate reconnection (use this._ws.close() if reconnection is required)

        this._reconnection = null;
        clearTimeout(this._reconnectionTimer);
        this._reconnectionTimer = null;

        if (!callback) {
            return;
        }

        if (!this._ws) {
            return callback();
        }

        this._disconnectCallback = callback;
        this._ws.close();
    }

    _onMessage(payload, finalize) {

        // Parse message

        try {
            payload = JSON.parse(payload);
        }
        catch (error) {
            return finalize(new Error('Invalid JSON content'));
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
            this._closeExplanation = 'Reconnection requested';
            return this._ws.close();
        }

        // Invalid session

        if (payload.op === internals.opCodes.invalidSession) {
            const resumable = payload.d;

            if (resumable) {
                return this._identify();
            }

            this._closeExplanation = 'Invalid session';
            return this._ws.close();
        }

        // Dispatch (all other gateway events have been handled)

        const event = payload.t;

        if (event === 'READY') {
            this.id = payload.d.session_id;
        }

        if (event === 'READY' || event === 'RESUMED') {
            finalize();
        }

        this.onDispatch(event, payload.d);

    }

    _beat() {

        if (!this._heartbeatAcked) {
            this._closeExplanation = 'Heartbeat unacknowledged';
            return this._ws.close();
        }

        this._heartbeatAcked = false;
        this.send({ op: internals.opCodes.heartbeat, d: this._seq });
    }

    _identify() {

        const token = this._settings.token;

        // Resume if possible

        if (this.id) {
            return this.send({
                op: internals.opCodes.resume,
                d: { token, session_id: this.id, seq: this._seq },
            });
        }

        // Identify new session

        this.send({
            op: internals.opCodes.identify,
            d: {
                token,
                shards: this.shard,
                intents: this.intents,
                properties: {
                    $os: internals.isBrowser ? 'browser' : process.platform,
                    $browser: 'quartz',
                    $device: 'quartz',
                },
            },
        });
    }

    send(payload) {

        Assert(this._ws, 'Cannot send payloads before connecting');

        this._payloads.push(payload);

        if (!this._ratelimitTimer) {

            this._ratelimitTimer = setInterval(() => {

                this._remainingPayloads = internals.ratelimit.total;
                this._processPendingPayloads();
            }, internals.ratelimit.timeout);
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

internals.resolveIntents = function (intents) {

    if (!intents) {
        return;
    }

    let bits = 0;
    for (const intent of intents) {
        const bitmask = typeof intent === 'string' ? internals.intents[intent] : intent;
        bits |= bitmask;
    }

    return bits;
};
