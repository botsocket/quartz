/* eslint-disable camelcase, no-global-assign, require-atomic-updates */

'use strict';

const Ws = require('ws');

const Quartz = require('../src');

const internals = {
    url: 'ws://localhost:3000',

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
};

describe('client()', () => {

    it('should throw on incorrect parameters', async () => {

    });

    it('should connect to gateway API', async () => {

        const sessionId = 'some_random_session_id';
        const heartbeatInterval = 5000;
        const cleanup = internals.gateway((socket, send) => {

            socket.on('message', (message) => {

                const payload = JSON.parse(message);

                if (payload.op === internals.opCodes.identify) {
                    send({ op: internals.opCodes.dispatch, t: 'READY', d: { session_id: sessionId } });
                }
            });

            // Hello

            send({ op: internals.opCodes.hello, d: { heartbeat_interval: heartbeatInterval } });
        });

        const original = global.setInterval;
        global.setInterval = function (_, ms) {

            expect(ms).toBe(heartbeatInterval);
        };

        const client = Quartz.client(internals.url, { token: 'test' });

        await client.connect();
        expect(client.id).toBe(sessionId);

        cleanup();
        global.setInterval = original;
    });
});

internals.gateway = function (handler) {

    const server = new Ws.Server({ port: 3000 });

    server.on('connection', (socket) => {

        const send = function (payload) {

            socket.send(JSON.stringify(payload));
        };

        handler(socket, send);
    });

    return function () {

        server.close();
        server.removeAllListeners();
    };
};
