'use strict';

const Ws = require('ws');

const internals = {
    gateway: null,                                 // Mocked gateway
};

exports.opCodes = {                                // https://discord.com/developers/docs/topics/opcodes-and-status-codes#gateway-gateway-opcodes
    dispatch: 0,
    heartbeat: 1,
    identify: 2,
    resume: 6,
    reconnect: 7,
    invalidSession: 9,
    hello: 10,
    heartbeatAck: 11,
};

exports.baseUrl = 'ws://localhost:3000';

afterEach(() => {

    if (internals.gateway) {
        const gateway = internals.gateway;
        internals.gateway = null;
        gateway.removeAllListeners();

        return new Promise((resolve) => {

            gateway.close(resolve);
        });
    }
});

exports.gateway = function (handler) {

    const gateway = new Ws.Server({ port: 3000 });
    internals.gateway = gateway;

    gateway.on('connection', (socket) => {

        if (!handler) {
            return;
        }

        const send = function (payload) {

            socket.send(JSON.stringify(payload));
        };

        const helpers = {
            hello(interval) {

                send({ op: exports.opCodes.hello, d: { heartbeat_interval: interval || 20000 } });            // Set interval to 20s by default, which is long enough to not cause the connection to close with Heartbeat unacknowledged
            },

            requestHeartbeat() {

                send({ op: exports.opCodes.heartbeat });
            },

            ackHeartbeat() {

                send({ op: exports.opCodes.heartbeatAck });
            },

            requestReconnection() {

                send({ op: exports.opCodes.reconnect });
            },

            invalidSession(resumable) {

                send({ op: exports.opCodes.invalidSession, d: resumable });
            },

            dispatch(event, data) {

                send({ op: exports.opCodes.dispatch, t: event, d: data });
            },

            resumed(seq) {

                send({ op: exports.opCodes.dispatch, t: 'RESUMED', d: null, s: seq });
            },

            ready(sessionId, seq) {

                send({ op: exports.opCodes.dispatch, t: 'READY', d: { session_id: sessionId }, s: seq });
            },
        };

        handler(socket, helpers);
    });

    return gateway;
};
