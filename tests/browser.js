/**
 * @jest-environment jsdom
 */

'use strict';

const Quartz = require('../src');
const Utils = require('./utils');

describe('browser', () => {

    it('should work in browser', async () => {

        const sessionId = 'some_random_session_id';
        const token = 'some_random_token';
        const seq = 1;

        const { cleanup, port } = Utils.gateway((socket, helpers) => {

            socket.on('message', () => {

                helpers.ready(sessionId, seq);
            });

            helpers.hello();
        });

        const client = Quartz.client(Utils.baseUrl + port, { token });

        await client.connect();
        expect(client.id).toBe(sessionId);
        expect(client._seq).toBe(seq);

        await client.disconnect();
        cleanup();
    });
});
