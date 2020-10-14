/**
 * @jest-environment node
 */

/* eslint-disable camelcase, no-global-assign, require-atomic-updates */

'use strict';

const Bone = require('@botsocket/bone');
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

    it('should connect to gateway API', async () => {

        const sessionId = 'some_random_session_id';

        const cleanup = internals.gateway((socket, helpers) => {

            socket.on('message', (message) => {

                const payload = JSON.parse(message);

                if (payload.op === internals.opCodes.identify) {
                    helpers.ready(sessionId);
                }
            });

            helpers.hello();
        });

        const client = Quartz.client(internals.url, { token: 'test' });

        await client.connect();
        expect(client.id).toBe(sessionId);

        await client.disconnect();
        cleanup();
    });

    it('should connect after disconnecting intentionally', async () => {

        const sessionId = 'some_random_session_id';

        const cleanup = internals.gateway((socket, helpers) => {

            socket.on('message', (message) => {

                const payload = JSON.parse(message);

                if (payload.op === internals.opCodes.identify) {
                    helpers.ready(sessionId);
                }
            });

            helpers.hello();
        });

        const client = Quartz.client(internals.url, { token: 'test' });

        await client.connect();
        await client.disconnect();
        await client.connect();
        expect(client.id).toBe(sessionId);

        await client.disconnect();
        cleanup();
    });

    it('should throw on invalid tokens', async () => {

        const cleanup = internals.gateway((socket, helpers) => {

            socket.on('message', (message) => {

                const payload = JSON.parse(message);

                if (payload.op === internals.opCodes.identify) {
                    socket.close(4004);
                }
            });

            helpers.hello();
        });

        const client = Quartz.client(internals.url, { token: 'test' });

        await expect(client.connect()).rejects.toThrow('Invalid token');

        await client.disconnect();
        cleanup();
    });

    it('should throw on invalid json response', async () => {

        const cleanup = internals.gateway((socket) => {

            socket.send('{');               // Raw send. No JSON.parse()
        });

        const client = Quartz.client(internals.url, { token: 'test' });

        await expect(client.connect()).rejects.toThrow('Invalid JSON content');

        await client.disconnect();
        cleanup();
    });

    it('should throw if server is unavailable', async () => {

        const client = Quartz.client(internals.url, { token: 'test' });

        await expect(client.connect()).rejects.toThrow('connect ECONNREFUSED 127.0.0.1:3000');
    });

    it('should throw if socket closes and reconnect is set to false', async () => {

        const cleanup = internals.gateway((socket) => {

            socket.close();
        });

        const client = Quartz.client(internals.url, { token: 'test', reconnect: false });

        await expect(client.connect()).rejects.toThrow('Cannot connect to Discord gateway API');

        await client.disconnect();
        cleanup();
    });

    it('should throw if socket closes and has reached maximum attempts', async () => {

        const cleanup = internals.gateway((socket) => {

            socket.close();
        });

        const client = Quartz.client(internals.url, { token: 'test', reconnect: { attempts: 2 } });

        await expect(client.connect()).rejects.toThrow('Cannot connect to Discord gateway API');

        await client.disconnect();
        cleanup();
    });

    it('should reconnect on socket close', async () => {

        const sessionId = 'some_random_session_id';

        let count = 0;
        const cleanup = internals.gateway((socket, helpers) => {

            count++;

            if (count > 2) {
                socket.on('message', (message) => {

                    const payload = JSON.parse(message);

                    if (payload.op === internals.opCodes.identify) {
                        helpers.ready(sessionId);
                    }
                });

                return helpers.hello();
            }

            socket.close();
        });

        const client = Quartz.client(internals.url, { token: 'test', reconnect: { attempts: 2 } });

        await client.connect();
        expect(client.id).toBe(sessionId);

        await client.disconnect();
        cleanup();
    });

    describe('connect()', () => {

        it('should throw when called twice', async () => {

            const cleanup = internals.gateway((socket, helpers) => {

                socket.on('message', (message) => {

                    const payload = JSON.parse(message);

                    if (payload.op === internals.opCodes.identify) {
                        helpers.ready();
                    }
                });

                helpers.hello();
            });

            const client = Quartz.client(internals.url, { token: 'test' });

            await client.connect();
            expect(() => client.connect()).toThrow('Client is already connecting');

            await client.disconnect();
            cleanup();
        });
    });

    describe('onError', () => {

        it('should log to console by default', async () => {

            const cleanup = internals.gateway((socket, helpers) => {

                socket.on('message', (message) => {

                    const payload = JSON.parse(message);

                    if (payload.op === internals.opCodes.identify) {
                        helpers.ready();
                    }
                });

                helpers.hello();
            });

            const client = Quartz.client(internals.url, { token: 'test', reconnect: false });

            const error = new Error('Test');

            const original = console.log;
            const promise = new Promise((resolve) => {

                console.log = async function (logError) {

                    expect(logError).toBe(error);

                    console.log = original;
                    await client.disconnect();
                    cleanup();
                    resolve();
                };
            });


            await client.connect();
            client._ws.emit('error', error);
            await promise;
        });
    });

    describe('onDispatch()', () => {

        it('should dispatch events', async () => {

            const data = { a: 1 };
            const event = 'ANOTHER_EVENT';
            const cleanup = internals.gateway((socket, helpers) => {

                socket.on('message', async (message) => {

                    const payload = JSON.parse(message);

                    if (payload.op === internals.opCodes.identify) {
                        helpers.ready();

                        await internals.wait(100);

                        helpers.dispatch(event, data);
                    }
                });

                helpers.hello();
            });

            const client = Quartz.client(internals.url, { token: 'test' });

            let count = 0;

            const promise = new Promise((resolve) => {

                client.onDispatch = async function (rawEvent, rawData) {

                    if (count === 1) {
                        expect(rawEvent).toBe(event);
                        expect(Bone.equal(rawData, data)).toBe(true);

                        await client.disconnect();
                        cleanup();
                        return resolve();
                    }

                    expect(rawEvent).toBe('READY');
                    count++;
                };
            });

            await client.connect();
            await promise;
        });
    });
});

internals.wait = function (ms) {

    return new Promise((resolve) => setTimeout(resolve, ms));
};

internals.gateway = function (handler) {

    const server = new Ws.Server({ port: 3000 });

    server.on('connection', (socket) => {

        if (!handler) {
            return;
        }

        const send = function (payload) {

            socket.send(JSON.stringify(payload));
        };

        const hello = function (interval) {

            send({ op: internals.opCodes.hello, d: { heartbeat_interval: interval || 5000 } });
        };

        const dispatch = function (event, data) {

            send({ op: internals.opCodes.dispatch, t: event, d: data });
        };

        const ready = function (sessionId) {

            dispatch('READY', { session_id: sessionId });
        };

        const helpers = {
            send,
            hello,
            dispatch,
            ready,
        };

        handler(socket, helpers);

    });

    return function () {

        server.close();
        server.removeAllListeners();
    };
};
