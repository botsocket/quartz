'use strict';

const Ws = require('ws');

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

exports.baseUrl = 'ws://localhost:';

exports.gateway = function (handler) {

    const server = new Ws.Server({ port: 0 });

    server.on('connection', (socket) => {

        if (!handler) {
            return;
        }

        const send = function (payload) {

            socket.send(JSON.stringify(payload));
        };

        const hello = function (interval) {

            send({ op: exports.opCodes.hello, d: { heartbeat_interval: interval || 20000 } });            // Set interval to 20s by default, which is long enough to not cause the connection to close with Heartbeat unacknowledged
        };

        const requestHeartbeat = function () {

            send({ op: exports.opCodes.heartbeat });
        };

        const ackHeartbeat = function () {

            send({ op: exports.opCodes.heartbeatAck });
        };

        const requestReconnection = function () {

            send({ op: exports.opCodes.reconnect });
        };

        const invalidSession = function (resumable) {

            send({ op: exports.opCodes.invalidSession, d: resumable });
        };

        const dispatch = function (event, data, seq) {

            send({ op: exports.opCodes.dispatch, t: event, d: data, s: seq });
        };

        const ready = function (sessionId, seq) {

            dispatch('READY', { session_id: sessionId }, seq);
        };

        const resumed = function (seq) {

            dispatch('RESUMED', null, seq);
        };

        const helpers = {
            hello,
            requestHeartbeat,
            ackHeartbeat,
            requestReconnection,
            invalidSession,
            dispatch,
            resumed,
            ready,
        };

        handler(socket, helpers);

    });

    return {
        port: server.address().port,

        cleanup() {

            server.close();
            server.removeAllListeners();
        },
    };
};
