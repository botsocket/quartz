'use strict';

const Bone = require('@botsocket/bone');

const Quartz = require('../src');
const Utils = require('./utils');

const internals = {};

afterEach(() => {

    jest.restoreAllMocks();
});

describe('client()', () => {

    it('should connect to gateway API', async () => {

        const sessionId = 'some_random_session_id';
        const token = 'some_random_token';
        const seq = 1;

        Utils.gateway((socket, helpers) => {

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

        const client = Quartz.client(Utils.baseUrl, { token });

        await client.connect();
        expect(client.id).toBe(sessionId);
        expect(client._seq).toBe(seq);

        await client.disconnect();
    });

    it('should connect after disconnecting intentionally', async () => {

        const sessionId = 'some_random_session_id';

        Utils.gateway((socket, helpers) => {

            socket.on('message', () => {

                helpers.ready(sessionId);
            });

            helpers.hello();
        });

        const client = Quartz.client(Utils.baseUrl, { token: 'test' });

        await client.connect();
        await client.disconnect();
        await client.connect();
        expect(client.id).toBe(sessionId);

        await client.disconnect();
    });

    it('should throw on invalid tokens', async () => {

        Utils.gateway((socket, helpers) => {

            socket.on('message', () => {

                socket.close(4004);
            });

            helpers.hello();
        });

        const client = Quartz.client(Utils.baseUrl, { token: 'test' });

        await expect(client.connect()).rejects.toThrow('Invalid token');

        await client.disconnect();
    });

    it('should throw on invalid json response', async () => {

        Utils.gateway((socket) => {

            socket.send('{');               // Raw send. No JSON.parse()
        });

        const client = Quartz.client(Utils.baseUrl, { token: 'test' });

        await expect(client.connect()).rejects.toThrow('Invalid JSON content');

        await client.disconnect();
    });

    it('should throw if server is unavailable', async () => {

        const client = Quartz.client('ws://localhost', { token: 'test' });

        await expect(client.connect()).rejects.toThrow('connect ECONNREFUSED 127.0.0.1');
        await client.disconnect();
    });

    it('should throw if socket closes and reconnect is set to false', async () => {

        Utils.gateway((socket) => {

            socket.close();
        });

        const client = Quartz.client(Utils.baseUrl, { token: 'test', reconnect: false });

        await expect(client.connect()).rejects.toThrow('Connection failed with code 1005 - No status received');

        await client.disconnect();
    });

    it('should throw if socket closes and has reached maximum attempts', async () => {

        Utils.gateway((socket) => {

            socket.close();
        });

        const client = Quartz.client(Utils.baseUrl, { token: 'test', reconnect: { attempts: 2, delay: 10 } });

        await expect(client.connect()).rejects.toThrow('Connection failed with code 1005 - No status received');

        await client.disconnect();
    });

    it('should connect after disconnection due to reaching maximum reconnection attempts', async () => {

        const sessionId = 'some_random_session_id';

        let count = 0;
        Utils.gateway((socket, helpers) => {

            if (count <= 2) {
                count++;
                return socket.close();
            }

            socket.on('message', () => {

                helpers.ready(sessionId);
            });

            helpers.hello();
        });

        const client = Quartz.client(Utils.baseUrl, { token: 'test', reconnect: { attempts: 2, delay: 10 } });
        await expect(client.connect()).rejects.toThrow('Connection failed with code 1005 - No status received');

        await client.connect();                 // Make sure client does not throw "'Cannot connect while the client is attempting to reconnect'"
        expect(client.id).toBe(sessionId);

        await client.disconnect();
    });

    it('should reconnect on socket close', async () => {

        const sessionId = 'some_random_session_id';

        let count = 0;
        Utils.gateway((socket, helpers) => {

            if (count === 2) {
                socket.on('message', () => {

                    helpers.ready(sessionId);
                });

                return helpers.hello();
            }

            socket.close();
            count++;
        });

        const client = Quartz.client(Utils.baseUrl, { token: 'test', reconnect: { attempts: 2, delay: 10 } });

        await client.connect();
        expect(client.id).toBe(sessionId);

        await client.disconnect();
    });

    it('should reconnect and then throw', async () => {

        const gateway = Utils.gateway((socket) => {

            socket.close();
            gateway.close();
        });

        const client = Quartz.client(Utils.baseUrl, { token: 'test', reconnect: { attempts: 1, delay: 10 } });

        await expect(client.connect()).rejects.toThrow('connect ECONNREFUSED 127.0.0.1:3000');

        await client.disconnect();
    });

    it('should send a heartbeat if requested', async () => {

        const seq = 1;

        let count = 0;
        const promise = new Promise((resolve) => {

            Utils.gateway((socket, helpers) => {

                socket.on('message', async (message) => {

                    if (count === 1) {
                        const payload = JSON.parse(message);

                        expect(payload.op).toBe(Utils.opCodes.heartbeat);
                        expect(payload.d).toBe(seq);

                        await client.disconnect();
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

        const client = Quartz.client(Utils.baseUrl, { token: 'test' });

        await client.connect();
        await promise;
    });

    it('should acknowledge heartbeat', async () => {

        let count = 0;
        const promise = new Promise((resolve) => {

            Utils.gateway((socket, helpers) => {

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
                        return resolve();
                    }

                    count++;
                });

                helpers.hello(100);
            });
        });

        const client = Quartz.client(Utils.baseUrl, { token: 'test' });

        await client.connect();
        await promise;
    });

    it('should disconnect if heartbeat is not acknowledged', async () => {

        Utils.gateway((socket, helpers) => {

            socket.on('message', () => {

                helpers.ready();
            });

            helpers.hello(10);             // Set to a short amount of time to cause the connection to close quickly due to Heartbeat unacknowledged
        });

        const client = Quartz.client(Utils.baseUrl, { token: 'test', reconnect: false });

        client.onError = () => { };        // Prevent console.log when running tests

        const promise = new Promise((resolve) => {

            client.onDisconnect = async function ({ explanation }) {

                expect(explanation).toBe('Heartbeat unacknowledged');

                await client.disconnect();
                resolve();
            };
        });

        await client.connect();
        await promise;
    });

    it('should reconnect if requested', async () => {

        let count = 0;
        const promise = new Promise((resolve) => {

            Utils.gateway((socket, helpers) => {

                socket.on('message', async () => {

                    if (!count) {
                        count++;
                        helpers.ready();
                        await internals.wait(100);
                        return helpers.requestReconnection();
                    }

                    await client.disconnect();
                    resolve();
                });

                helpers.hello();
            });
        });

        const client = Quartz.client(Utils.baseUrl, { token: 'test', reconnect: { delay: 10 } });

        expect.hasAssertions();

        client.onDisconnect = function ({ explanation }) {

            expect(explanation).toBe('Reconnection requested');
        };

        await client.connect();
        await promise;
    });

    it('should resume connection if id is set in options', async () => {

        const sessionId = 'some_random_session_id';
        const token = 'some_random_token';

        Utils.gateway((socket, helpers) => {

            socket.on('message', (message) => {

                const payload = JSON.parse(message);

                expect(payload.d.token).toBe(token);
                expect(payload.d.session_id).toBe(sessionId);
                expect(payload.d.seq).toBe(null);

                helpers.resumed();
            });

            helpers.hello();
        });

        const client = Quartz.client(Utils.baseUrl, { token, id: sessionId });

        await client.connect();
        await client.disconnect();
    });

    it('should resume invalid session if possible', async () => {

        const sessionId = 'some_session_id';
        const token = 'some_random_token';
        const seq = 1;

        let count = 0;
        Utils.gateway((socket, helpers) => {

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

        const client = Quartz.client(Utils.baseUrl, { token });

        const promise = new Promise((resolve) => {

            client.onDispatch = async function (event) {

                if (count === 1) {
                    expect(event).toBe('RESUMED');
                    await client.disconnect();
                    resolve();
                }
            };
        });

        await client.connect();
        await promise;
    });

    it('should disconnect if session is not resumable', async () => {

        Utils.gateway((socket, helpers) => {

            socket.on('message', async () => {

                helpers.ready();

                await internals.wait(100);
                helpers.invalidSession(false);
            });

            helpers.hello();
        });

        const client = Quartz.client(Utils.baseUrl, { token: 'test', reconnect: false });

        client.onError = () => { };             // Prevent console.log when running tests

        const promise = new Promise((resolve) => {

            client.onDisconnect = async function ({ explanation }) {

                expect(explanation).toBe('Invalid session');

                await client.disconnect();
                resolve();
            };
        });

        await client.connect();
        await promise;
    });

    it('should accept single numeric intents', async () => {

        const intents = 1 << 0;

        Utils.gateway((socket, helpers) => {

            socket.on('message', (message) => {

                const payload = JSON.parse(message);
                expect(payload.d.intents).toBe(intents);

                helpers.ready();
            });

            helpers.hello();
        });

        const client = Quartz.client(Utils.baseUrl, { token: 'test', intents });

        await client.connect();
        expect(client.intents).toBe(intents);

        await client.disconnect();
    });

    it('should accept an array of numeric intents', async () => {

        const intents = 1 << 0 | 1 << 1;

        Utils.gateway((socket, helpers) => {

            socket.on('message', (message) => {

                const payload = JSON.parse(message);
                expect(payload.d.intents).toBe(intents);

                helpers.ready();
            });

            helpers.hello();
        });

        const client = Quartz.client(Utils.baseUrl, { token: 'test', intents: [1 << 0, 1 << 1] });

        await client.connect();
        expect(client.intents).toBe(intents);

        await client.disconnect();
    });

    it('should accept single string intents', async () => {

        const intents = 1 << 0;

        Utils.gateway((socket, helpers) => {

            socket.on('message', (message) => {

                const payload = JSON.parse(message);
                expect(payload.d.intents).toBe(intents);

                helpers.ready();
            });

            helpers.hello();
        });

        const client = Quartz.client(Utils.baseUrl, { token: 'test', intents: 'GUILDS' });

        await client.connect();
        expect(client.intents).toBe(intents);

        await client.disconnect();
    });

    it('should accept an array of string intents and numeric intents', async () => {

        const intents = 1 << 0 | 1 << 1 | 1 << 2;

        Utils.gateway((socket, helpers) => {

            socket.on('message', (message) => {

                const payload = JSON.parse(message);
                expect(payload.d.intents).toBe(intents);

                helpers.ready();
            });

            helpers.hello();
        });

        const client = Quartz.client(Utils.baseUrl, { token: 'test', intents: ['GUILDS', 'GUILD_MEMBERS', 1 << 2] });

        await client.connect();
        expect(client.intents).toBe(intents);

        await client.disconnect();
    });

    describe('connect()', () => {

        it('should throw when called twice', async () => {

            Utils.gateway((socket, helpers) => {

                socket.on('message', () => {

                    helpers.ready();
                });

                helpers.hello();
            });

            const client = Quartz.client(Utils.baseUrl, { token: 'test' });

            await client.connect();
            expect(() => client.connect()).toThrow('Client is already connecting');

            await client.disconnect();
        });
    });

    describe('send()', () => {

        it('should throw if not connected', () => {

            const client = Quartz.client('ws://localhost', { token: 'test' });

            expect(() => client.send({ a: 1 })).toThrow('Cannot send payloads before connecting');
        });

        it('should not hit rate limit', async () => {

            const total = 120;
            const extra = 10;

            Utils.gateway((socket, helpers) => {

                socket.on('message', () => {

                    return helpers.ready();
                });

                helpers.hello();
            });

            // Retrieve the rate limit reset function

            let reset;
            jest.spyOn(global, 'setInterval').mockImplementation((fn, ms) => {

                if (ms === 60 * 1000) {             // We know this is the timer for rate limit based on the interval
                    reset = fn;
                }
            });

            const client = Quartz.client(Utils.baseUrl, { token: 'test' });
            const promise = client.connect();

            const send = jest.spyOn(client._ws, 'send');

            await promise;

            // Send payloads

            const payloads = new Array(total + extra).fill({ a: 1 });
            for (const payload of payloads) {
                client.send(payload);
            }

            expect(send.mock.calls.length).toBe(total);

            // Reset

            send.mockClear();
            reset();

            // Continue sending

            expect(send.mock.calls.length).toBe(extra + 1);         // +1 because we initially sent an identify payload

            await client.disconnect();
        });
    });

    describe('onError', () => {

        it('should log to console by default', async () => {

            Utils.gateway((socket, helpers) => {

                socket.on('message', () => {

                    helpers.ready();
                });

                helpers.hello();
            });

            const client = Quartz.client(Utils.baseUrl, { token: 'test', reconnect: false });

            const error = new Error('Test');
            const log = jest.spyOn(console, 'log').mockImplementation(() => { });

            await client.connect();
            client._ws.emit('error', error);

            expect(log.mock.calls.length).toBe(1);
            expect(log.mock.calls[0][0]).toBe(error);

            await client.disconnect();
        });
    });

    describe('onDispatch()', () => {

        it('should dispatch events', async () => {

            const data = { a: 1 };
            const event = 'ANOTHER_EVENT';
            Utils.gateway((socket, helpers) => {

                socket.on('message', async () => {

                    helpers.ready();
                    await internals.wait(100);
                    helpers.dispatch(event, data);

                });

                helpers.hello();
            });

            const client = Quartz.client(Utils.baseUrl, { token: 'test' });

            let count = 0;
            const promise = new Promise((resolve) => {

                client.onDispatch = async function (rawEvent, rawData) {

                    if (count === 1) {
                        expect(rawEvent).toBe(event);
                        expect(Bone.equal(rawData, data)).toBe(true);

                        await client.disconnect();
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
