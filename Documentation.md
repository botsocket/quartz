# Documentation

## Introduction

Quartz is a module that simplies Discord gateway connection.

## Installation

Quartz is available on npm:

```bash
npm install @botsocket/quartz
```

## Usage

```js
const Quartz = require('@botsocket/quartz');

const client = Quartz.client('wss://gateway.discord.gg', {
    token: 'authentication_token',
});

client.onDispatch = function (event) {

    if (event === 'READY') {
        console.log('Gateway is ready');
    }
};

client.connect();
```

## API

-  [`client()`](#clienturl-options)
    -   [`client.connect()`](#clientconnect)
    -   [`client.disconnect()`](#clientdisconnect)
    -   [`client.send()`](#clientsendpayload)
    -   [`client.onDispatch`](#clientonDispatch)
    -   [`client.onDisconnect`](#clientonDisconnect)
    -   [`client.onError`](#clientonError)
    -   [`client.id`](#clientid)
    -   [`client.url`](#clienturl)
    -   [`client.shard`](#clientshard)
    -   [`client.intents`](#clientintents)
- [Available intents](#available-intents)

### `client(url, options)`

Creates a Gateway client where:

-   `url`: The gateway URL. Must be passed explicitly. This allows the URL to be cached as requested [here](https://discord.com/developers/docs/topics/gateway#get-gateway)
-   `options`: Connection options where:
    -   `token`: The authentication token.
    -   `id`: The session id to resume connection. Optional.
    -   `shard`: A tuple containing sharding information. The first item is the current shard id and the second item is the total number of shards. Defaults to `[0, 1]`
    -   `intents`: [Gateway intents](https://discord.com/developers/docs/topics/gateway#gateway-intents). Can be any of [these](#available-intents), their corresponding values or an array of both types. Optional.
    -   `reconnect`: Reconnection options where:
        -   `attempts`: The number of reconnection attempts. Defaults to `Infinity`.
        -   `delay`: The amount of time in milliseconds to backoff before reconnecting. Defaults to `1000`.
        -   `maxDelay`: The maximum amount of time in milliseconds to backoff before reconnecting. Defaults to `5000`.

```js

const client = Quartz.client('wss://gateway.discord.gg', {
    token: 'authentication_token',
    id: 'my_random_session_id',
    shard: [0, 5],
    intents: ['GUILDS', 'GUILD_MEMBERS', 1 << 2],
    reconnect: {
        attempts: 5,
        delay: 500,
        maxDelay: 2000,
    }
});

```

[Back to top](#api)

#### `client.connect()`

Connects to Discord Gateway API. Returns a promise that when resolved signifies a successful connection.

```js
async function connect() {
    const client = Quartz.client('wss://gateway.discord.gg', {
        token: 'authentication_token',
    });

    await client.connect();
    console.log('Successfully connected');
}
```

[Back to top](#api)

#### `client.disconnect()`

Closes the connection to Discord Gateway API and performs necessary cleanup. Returns a promise that when resolved signifies a successful disconnection.

```js
async function connect() {
    const client = Quartz.client('wss://gateway.discord.gg', {
        token: 'authentication_token',
    });

    await client.connect();
    console.log('Successfully connected');

    await client.disconnect();
    console.log('Oops, disconnected');
}
```

[Back to top](#api)

#### `client.send(payload)`

Sends a payload to Discord Gateway API where:

-   `payload`: The payload to send. Will call `JSON.stringify()` automatically.

Note that this method is aware of the Discord rate limit of 120 payloads per minute. Pending payloads will be sent after the rate limit resets. Attempting to invoke it before calling [`client.connect()`](#clientconnect) will throw an error.

```js
async function connect() {
    const client = Quartz.client('wss://gateway.discord.gg', {
        token: 'authentication_token',
    });

    await client.connect();
    console.log('Successfully connected');

    client.send({ op: 8, d: { /* Some payload */ } });
}
```

[Back to top](#api)

#### `client.onDispatch`

Listener invoked when Discord replies with the [dispatch event](https://discord.com/developers/docs/topics/gateway#sending-payloads-example-gateway-dispatch). Called with:

-   `event`: The name of event. For example, `GUILD_CREATE` or `CHANNEL_CREATE`.
-   `data`: The payload associated with this event.

```js
const client = Quartz.client('wss://gateway.discord.gg', {
    token: 'authentication_token',
});

client.onDispatch = function (event, data) {

    switch (event) {
        case 'READY':
            // Do stuff
            break;

        case 'GUILD_CREATE':
            // Do stuff
            break;
    }
};

client.connect();
```

[Back to top](#api)

#### `client.onDisconnect`

Listener invoked whenever the connection is closed, including closures before establishing reconnections. Called with:

- `info`: Closure information where:
    -   `code`: WebSocket close code, if any.
    -   `reason`: WebSocket close reason, if any.
    -   `explanation`: Human-friendly explanation of the closure if executed on the client-side.

```js
const client = Quartz.client('wss://gateway.discord.gg', {
    token: 'authentication_token',
});

client.onDisconnect = function (info) {

    console.log('Connection closed', info.code, info.reason, info.explanation);
};

client.connect();
```

[Back to top](#api)

#### `client.onError`

Listener invoked whenever an error is encountered. Defaults to `(error) => console.log(error);`. Called with:

-   `error`: The error being encountered.

```js
const client = Quartz.client('wss://gateway.discord.gg', {
    token: 'authentication_token',
});

client.onError = function (error) {

    console.log('Erroed', error.message);
};

client.connect();
```

[Back to top](#api)

#### `client.id`

Session id.

[Back to top](#api)

#### `client.url`

Discord gateway url used to establish the connection.

[Back to top](#api)

#### `client.shard`

Sharding information of format `[currentShardId, totalNoOfShards]`

[Back to top](#api)

#### `client.intents`

Resolved intents.

[Back to top](#api)

### Available intents

Below are the available intent names and their corresponding values:

```
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
```

