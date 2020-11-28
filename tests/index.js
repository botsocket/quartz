/* eslint-disable require-atomic-updates */

'use strict';

const Bone = require('@botsocket/bone');

const Quartz = require('../src');
const Utils = require('./utils');

const internals = {};

describe('client()', () => {

    it('should connect to gateway API', async () => {

        const sessionId = 'some_random_session_id';
        const token = 'some_random_token';
        const seq = 1;

        const cleanup = Utils.gateway((socket, helpers) => {

            socket.on('message', (message) => {

                const payload = JSON.parse(message);
                const data = payload.d;

                expect(data.shards[0]).toBe(0);
                expect(data.shards[1]).toBe(1);
                expect(data.token).toBe(token);
                expect(data.properties.$os).toBe(process.platform);
                expect(data.properties.$browser).toBe('quartz');
                expect(data.properties.$device).toBe('quartz');

                helpers.ready(sessionId, seq);
            });

            helpers.hello();
        });

        const client = Quartz.client(Utils.url, { token });

        await client.connect();
        expect(client.id).toBe(sessionId);
        expect(client._seq).toBe(seq);

        await client.disconnect();
        cleanup();
    });

    it('should connect after disconnecting intentionally', async () => {

        const sessionId = 'some_random_session_id';

        const cleanup = Utils.gateway((socket, helpers) => {

            socket.on('message', () => {

                helpers.ready(sessionId);
            });

            helpers.hello();
        });

        const client = Quartz.client(Utils.url, { token: 'test' });

        await client.connect();
        await client.disconnect();
        await client.connect();
        expect(client.id).toBe(sessionId);

        await client.disconnect();
        cleanup();
    });

    it('should throw on invalid tokens', async () => {

        const cleanup = Utils.gateway((socket, helpers) => {

            socket.on('message', () => {

                socket.close(4004);
            });

            helpers.hello();
        });

        const client = Quartz.client(Utils.url, { token: 'test' });

        await expect(client.connect()).rejects.toThrow('Invalid token');

        await client.disconnect();
        cleanup();
    });

    it('should throw on invalid json response', async () => {

        const cleanup = Utils.gateway((socket) => {

            socket.send('{');               // Raw send. No JSON.parse()
        });

        const client = Quartz.client(Utils.url, { token: 'test' });

        await expect(client.connect()).rejects.toThrow('Invalid JSON content');

        await client.disconnect();
        cleanup();
    });

    it('should throw if server is unavailable', async () => {

        const client = Quartz.client(Utils.url, { token: 'test' });

        await expect(client.connect()).rejects.toThrow('connect ECONNREFUSED 127.0.0.1:3000');

        await client.disconnect();
    });

    it('should throw if socket closes and reconnect is set to false', async () => {

        const cleanup = Utils.gateway((socket) => {

            socket.close();
        });

        const client = Quartz.client(Utils.url, { token: 'test', reconnect: false });

        await expect(client.connect()).rejects.toThrow('Connection failed with code 1005 - No status received');

        await client.disconnect();
        cleanup();
    });

    it('should throw if socket closes and has reached maximum attempts', async () => {

        const cleanup = Utils.gateway((socket) => {

            socket.close();
        });

        const client = Quartz.client(Utils.url, { token: 'test', reconnect: { attempts: 2, delay: 10 } });

        await expect(client.connect()).rejects.toThrow('Connection failed with code 1005 - No status received');

        await client.disconnect();
        cleanup();
    });

    it('should connect after disconnection due to reaching maximum reconnection attempts', async () => {

        const sessionId = 'some_random_session_id';

        let count = 0;
        const cleanup = Utils.gateway((socket, helpers) => {

            if (count <= 2) {
                count++;
                return socket.close();
            }

            socket.on('message', () => {

                helpers.ready(sessionId);
            });

            helpers.hello();
        });

        const client = Quartz.client(Utils.url, { token: 'test', reconnect: { attempts: 2, delay: 10 } });
        await expect(client.connect()).rejects.toThrow('Connection failed with code 1005 - No status received');

        await client.connect();                 // Make sure client does not throw "'Cannot connect while the client is attempting to reconnect'"
        expect(client.id).toBe(sessionId);

        await client.disconnect();
        cleanup();
    });

    it('should reconnect on socket close', async () => {

        const sessionId = 'some_random_session_id';

        let count = 0;
        const cleanup = Utils.gateway((socket, helpers) => {

            if (count === 2) {
                socket.on('message', () => {

                    helpers.ready(sessionId);
                });

                return helpers.hello();
            }

            socket.close();
            count++;
        });

        const client = Quartz.client(Utils.url, { token: 'test', reconnect: { attempts: 2, delay: 10 } });

        await client.connect();
        expect(client.id).toBe(sessionId);

        await client.disconnect();
        cleanup();
    });

    it('should reconnect and then throw', async () => {

        const cleanup = Utils.gateway((socket) => {

            socket.close();
            cleanup();
        });

        const client = Quartz.client(Utils.url, { token: 'test', reconnect: { attempts: 1, delay: 10 } });

        await expect(client.connect()).rejects.toThrow('connect ECONNREFUSED 127.0.0.1:3000');

        await client.disconnect();
    });

    it('should send a heartbeat if requested', async () => {

        const seq = 1;

        let count = 0;
        const promise = new Promise((resolve) => {

            const cleanup = Utils.gateway((socket, helpers) => {

                socket.on('message', async (message) => {

                    if (count === 1) {
                        const payload = JSON.parse(message);

                        expect(payload.op).toBe(Utils.opCodes.heartbeat);
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

        const client = Quartz.client(Utils.url, { token: 'test' });

        await client.connect();
        await promise;
    });

    it('should acknowledge heartbeat', async () => {

        let count = 0;
        const promise = new Promise((resolve) => {

            const cleanup = Utils.gateway((socket, helpers) => {

                socket.on('message', async (message) => {

                    if (count === 0) {
                        helpers.ready();
                    }

                    const assertHeartbeatPayload = function () {

                        const payload = JSON.parse(message);
                        expect(payload.op).toBe(Utils.opCodes.heartbeat);
                    };

                    if (count === 1) {
                        assertHeartbeatPayload();
                        helpers.ackHeartbeat();
                    }

                    if (count === 2) {
                        assertHeartbeatPayload();
                        await client.disconnect();
                        cleanup();
                        return resolve();
                    }

                    count++;
                });

                helpers.hello(100);
            });
        });

        const client = Quartz.client(Utils.url, { token: 'test' });

        await client.connect();
        await promise;
    });

    it('should disconnect if heartbeat is not acknowledged', async () => {

        const cleanup = Utils.gateway((socket, helpers) => {

            socket.on('message', () => {

                helpers.ready();
            });

            helpers.hello(10);             // Set to a short amount of time to cause the connection to close quickly due to Heartbeat unacknowledged
        });

        const client = Quartz.client(Utils.url, { token: 'test', reconnect: false });

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
        const cleanup = Utils.gateway((socket, helpers) => {

            socket.on('message', () => {

                if (count === 1) {
                    return helpers.ready();
                }

                helpers.requestReconnection();
                count++;
            });

            helpers.hello();
        });

        const client = Quartz.client(Utils.url, { token: 'test', reconnect: { delay: 10 } });

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

        const cleanup = Utils.gateway((socket, helpers) => {

            socket.on('message', (message) => {

                const payload = JSON.parse(message);

                expect(payload.d.token).toBe(token);
                expect(payload.d.session_id).toBe(sessionId);
                expect(payload.d.seq).toBe(null);

                helpers.resumed();
            });

            helpers.hello();
        });

        const client = Quartz.client(Utils.url, { token, id: sessionId });

        await client.connect();

        await client.disconnect();
        cleanup();
    });

    it('should resume invalid session if possible', async () => {

        const sessionId = 'some_session_id';
        const token = 'some_random_token';
        const seq = 1;

        let count = 0;
        const cleanup = Utils.gateway((socket, helpers) => {

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

        const client = Quartz.client(Utils.url, { token });

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

        const cleanup = Utils.gateway((socket, helpers) => {

            socket.on('message', async () => {

                helpers.ready();

                await internals.wait(100);
                helpers.invalidSession(false);
            });

            helpers.hello();
        });

        const client = Quartz.client(Utils.url, { token: 'test', reconnect: false });

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

    it('should accept single numeric intents', async () => {

        const intents = 1 << 0;

        const cleanup = Utils.gateway((socket, helpers) => {

            socket.on('message', (message) => {

                const payload = JSON.parse(message);

                expect(payload.d.intents).toBe(intents);

                helpers.ready();
            });

            helpers.hello();
        });

        const client = Quartz.client(Utils.url, { token: 'test', intents });

        await client.connect();
        expect(client.intents).toBe(intents);

        await client.disconnect();
        cleanup();
    });

    it('should accept an array of numeric intents', async () => {

        const intents = 1 << 0 | 1 << 1;

        const cleanup = Utils.gateway((socket, helpers) => {

            socket.on('message', (message) => {

                const payload = JSON.parse(message);

                expect(payload.d.intents).toBe(intents);

                helpers.ready();
            });

            helpers.hello();
        });

        const client = Quartz.client(Utils.url, { token: 'test', intents: [1 << 0, 1 << 1] });

        await client.connect();
        expect(client.intents).toBe(intents);

        await client.disconnect();
        cleanup();
    });

    it('should accept single string intents', async () => {

        const intents = 1 << 0;

        const cleanup = Utils.gateway((socket, helpers) => {

            socket.on('message', (message) => {

                const payload = JSON.parse(message);

                expect(payload.d.intents).toBe(intents);

                helpers.ready();
            });

            helpers.hello();
        });

        const client = Quartz.client(Utils.url, { token: 'test', intents: 'GUILDS' });

        await client.connect();
        expect(client.intents).toBe(intents);

        await client.disconnect();
        cleanup();
    });

    it('should accept an array of string intents and numeric intents', async () => {

        const intents = 1 << 0 | 1 << 1 | 1 << 2;

        const cleanup = Utils.gateway((socket, helpers) => {

            socket.on('message', (message) => {

                const payload = JSON.parse(message);

                expect(payload.d.intents).toBe(intents);

                helpers.ready();
            });

            helpers.hello();
        });

        const client = Quartz.client(Utils.url, { token: 'test', intents: ['GUILDS', 'GUILD_MEMBERS', 1 << 2] });

        await client.connect();
        expect(client.intents).toBe(intents);

        await client.disconnect();
        cleanup();
    });

    describe('connect()', () => {

        it('should throw when called twice', async () => {

            const cleanup = Utils.gateway((socket, helpers) => {

                socket.on('message', () => {

                    helpers.ready();
                });

                helpers.hello();
            });

            const client = Quartz.client(Utils.url, { token: 'test' });

            await client.connect();
            expect(() => client.connect()).toThrow('Client is already connecting');

            await client.disconnect();
            cleanup();
        });

        it('should throw if called while reconnecting', () => {


        });
    });

    describe('send()', () => {

        it('should throw if not connected', () => {

            const client = Quartz.client(Utils.url, { token: 'test' });

            expect(() => client.send({ a: 1 })).toThrow('Cannot send payloads before connecting');
        });

        it('should not hit rate limit', async () => {

            const total = 120;
            const extra = 10;

            const cleanup = Utils.gateway((socket, helpers) => {

                socket.on('message', () => {

                    helpers.ready();
                });

                helpers.hello();
            });

            // Retrieve the rate limit reset function

            let resetFn;
            const originalSetInterval = global.setInterval;
            global.setInterval = function (fn, ms) {

                if (ms === 60 * 1000) {             // We know this is the timer for rate limit based on the interval
                    resetFn = fn;
                }
            };

            const client = Quartz.client(Utils.url, { token: 'test' });

            const promise = client.connect();

            // Mock ws.send() to count the number of times it was called

            let count = 0;
            const originalSend = client._ws.send;
            client._ws.send = function (payload) {

                count++;
                originalSend.call(this, payload);
            };

            // Connect

            await promise;

            // Send payloads

            const payloads = new Array(total + extra).fill({ a: 1 });
            for (const payload of payloads) {
                client.send(payload);
            }

            expect(client._remainingPayloads).toBe(0);
            expect(client._payloads.length).toBe(extra + 1);                // +1 because we are also sending the identify payload
            expect(count).toBe(total);

            // Reset

            count = 0;
            await internals.wait(100);
            resetFn();

            // Continue sending

            expect(client._payloads.length).toBe(0);
            expect(client._remainingPayloads).toBe(total - extra - 1);      // -1 because we are also sending the identify payload
            expect(count).toBe(extra + 1);                                  // +1 because we are also sending the identify payload

            // Cleanup

            global.setInterval = originalSetInterval;
            client._ws.send = originalSend;
            await client.disconnect();
            cleanup();
        });
    });

    describe('onError', () => {

        it('should log to console by default', async () => {

            const cleanup = Utils.gateway((socket, helpers) => {

                socket.on('message', () => {

                    helpers.ready();
                });

                helpers.hello();
            });

            const client = Quartz.client(Utils.url, { token: 'test', reconnect: false });

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
            const cleanup = Utils.gateway((socket, helpers) => {

                socket.on('message', async () => {

                    helpers.ready();
                    await internals.wait(100);
                    helpers.dispatch(event, data);

                });

                helpers.hello();
            });

            const client = Quartz.client(Utils.url, { token: 'test' });

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
