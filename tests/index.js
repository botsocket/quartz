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
        const token = 'some_random_token';
        const seq = 1;

        const cleanup = internals.gateway((socket, helpers) => {

            socket.on('message', (message) => {

                const payload = JSON.parse(message);

                expect(payload.d.token).toBe(token);
                expect(payload.d.properties.$os).toBe(process.platform);
                expect(payload.d.properties.$browser).toBe('quartz');
                expect(payload.d.properties.$device).toBe('quartz');

                helpers.ready(sessionId, seq);
            });

            helpers.hello();
        });

        const client = Quartz.client(internals.url, { token });

        await client.connect();
        expect(client.id).toBe(sessionId);
        expect(client._seq).toBe(seq);

        await client.disconnect();
        cleanup();
    });

    it('should connect after disconnecting intentionally', async () => {

        const sessionId = 'some_random_session_id';

        const cleanup = internals.gateway((socket, helpers) => {

            socket.on('message', () => {

                helpers.ready(sessionId);
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

            socket.on('message', () => {

                socket.close(4004);
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

        await client.disconnect();
    });

    it('should throw if socket closes and reconnect is set to false', async () => {

        const cleanup = internals.gateway((socket) => {

            socket.close();
        });

        const client = Quartz.client(internals.url, { token: 'test', reconnect: false });

        await expect(client.connect()).rejects.toThrow('Connection failed with code 1005 - No status received');

        await client.disconnect();
        cleanup();
    });

    it('should throw if socket closes and has reached maximum attempts', async () => {

        const cleanup = internals.gateway((socket) => {

            socket.close();
        });

        const client = Quartz.client(internals.url, { token: 'test', reconnect: { attempts: 2, delay: 10 } });

        await expect(client.connect()).rejects.toThrow('Connection failed with code 1005 - No status received');

        await client.disconnect();
        cleanup();
    });

    it('should reconnect on socket close', async () => {

        const sessionId = 'some_random_session_id';

        let count = 0;
        const cleanup = internals.gateway((socket, helpers) => {

            if (count === 2) {
                socket.on('message', () => {

                    helpers.ready(sessionId);
                });

                return helpers.hello();
            }

            socket.close();
            count++;
        });

        const client = Quartz.client(internals.url, { token: 'test', reconnect: { attempts: 2, delay: 10 } });

        await client.connect();
        expect(client.id).toBe(sessionId);

        await client.disconnect();
        cleanup();
    });

    it('should reconnect and then throw', async () => {

        const cleanup = internals.gateway((socket) => {

            socket.close();
            cleanup();
        });

        const client = Quartz.client(internals.url, { token: 'test', reconnect: { attempts: 1, delay: 10 } });

        await expect(client.connect()).rejects.toThrow('connect ECONNREFUSED 127.0.0.1:3000');

        await client.disconnect();
    });

    it('should send a heartbeat if requested', async () => {

        const seq = 1;

        let count = 0;
        const promise = new Promise((resolve) => {

            const cleanup = internals.gateway((socket, helpers) => {

                socket.on('message', async (message) => {

                    if (count === 1) {
                        const payload = JSON.parse(message);

                        expect(payload.op).toBe(internals.opCodes.heartbeat);
                        expect(payload.d).toBe(seq);

                        await client.disconnect();
                        cleanup();
                        return resolve();
                    }

                    helpers.ready(null, seq);
                    await internals.wait(100);
                    helpers.requestHeartbeat();

                    count++;
                });

                helpers.hello();
            });
        });

        const client = Quartz.client(internals.url, { token: 'test' });

        await client.connect();
        await promise;
    });

    it('should disconnect if heartbeat is not acknowledged', async () => {

        const cleanup = internals.gateway((socket, helpers) => {

            socket.on('message', () => {

                helpers.ready();
            });

            helpers.hello(10);             // Set to a short amount of time to cause the connection to close quickly due to Heartbeat unacknowledged
        });

        const client = Quartz.client(internals.url, { token: 'test', reconnect: false });

        client.onError = () => { };        // Prevent console.log when running tests

        const promise = new Promise((resolve) => {

            client.onDisconnect = async function ({ explanation }) {

                expect(explanation).toBe('Heartbeat unacknowledged');

                await client.disconnect();
                cleanup();
                resolve();
            };
        });

        await client.connect();
        await promise;
    });

    it('should reconnect if requested', async () => {

        let count = 0;
        const cleanup = internals.gateway((socket, helpers) => {

            socket.on('message', () => {

                if (count === 1) {
                    return helpers.ready();
                }

                helpers.requestReconnection();
                count++;
            });

            helpers.hello();
        });

        const client = Quartz.client(internals.url, { token: 'test', reconnect: { delay: 10 } });

        // Finish before client.connect() resolves

        client.onDisconnect = function ({ explanation }) {

            if (count === 0) {
                expect(explanation).toBe('Reconnection request');
            }
        };

        await client.connect();

        await client.disconnect();
        cleanup();
    });

    it('should resume connection if id is set in options', async () => {

        const sessionId = 'some_random_session_id';
        const token = 'some_random_token';

        const cleanup = internals.gateway((socket, helpers) => {

            socket.on('message', (message) => {

                const payload = JSON.parse(message);

                expect(payload.d.token).toBe(token);
                expect(payload.d.session_id).toBe(sessionId);
                expect(payload.d.seq).toBe(null);

                helpers.resumed();
            });

            helpers.hello();
        });

        const client = Quartz.client(internals.url, { token, id: sessionId });

        await client.connect();

        await client.disconnect();
        cleanup();
    });

    it('should resume invalid session if possible', async () => {

        const sessionId = 'some_session_id';
        const token = 'some_random_token';
        const seq = 1;

        let count = 0;
        const cleanup = internals.gateway((socket, helpers) => {

            socket.on('message', async (message) => {

                if (count === 1) {
                    const payload = JSON.parse(message);

                    expect(payload.d.token).toBe(token);
                    expect(payload.d.session_id).toBe(sessionId);
                    expect(payload.d.seq).toBe(seq);

                    return helpers.resumed();
                }

                helpers.ready(sessionId, seq);
                await internals.wait(100);
                helpers.invalidSession(true);

                count++;                    // Increment last so when READY event is dispatched count is still 0
            });

            helpers.hello();
        });

        const client = Quartz.client(internals.url, { token });

        const promise = new Promise((resolve) => {

            client.onDispatch = async function (event) {

                if (count === 1) {
                    expect(event).toBe('RESUMED');
                    await client.disconnect();
                    cleanup();
                    resolve();
                }
            };
        });

        await client.connect();
        await promise;
    });

    it('should disconnect if session is not resumable', async () => {

        const cleanup = internals.gateway((socket, helpers) => {

            socket.on('message', async () => {

                helpers.ready();

                await internals.wait(100);
                helpers.invalidSession(false);
            });

            helpers.hello();
        });

        const client = Quartz.client(internals.url, { token: 'test', reconnect: false });

        client.onError = () => { };             // Prevent console.log when running tests

        const promise = new Promise((resolve) => {

            client.onDisconnect = async function ({ explanation }) {

                expect(explanation).toBe('Invalid session');

                await client.disconnect();
                cleanup();
                resolve();
            };
        });

        await client.connect();
        await promise;
    });

    describe('connect()', () => {

        it('should throw when called twice', async () => {

            const cleanup = internals.gateway((socket, helpers) => {

                socket.on('message', () => {

                    helpers.ready();
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

                socket.on('message', () => {

                    helpers.ready();
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

                socket.on('message', async () => {

                    helpers.ready();
                    await internals.wait(100);
                    helpers.dispatch(event, data);

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

            send({ op: internals.opCodes.hello, d: { heartbeat_interval: interval || 30000 } });            // Set interval to 30s by default, which is long enough to not cause the connection to close with Heartbeat unacknowledged
        };

        const requestHeartbeat = function () {

            send({ op: internals.opCodes.heartbeat });
        };

        const requestReconnection = function () {

            send({ op: internals.opCodes.reconnect });
        };

        const invalidSession = function (resumable) {

            send({ op: internals.opCodes.invalidSession, d: resumable });
        };

        const dispatch = function (event, data, seq) {

            send({ op: internals.opCodes.dispatch, t: event, d: data, s: seq });
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
            requestReconnection,
            invalidSession,
            dispatch,
            resumed,
            ready,
        };

        handler(socket, helpers);

    });

    return function () {

        server.close();
        server.removeAllListeners();
    };
};
