# Documentation

## Introduction

Hubble is a browser-friendly module that simplies Discord gateway connection.

## Installation

Hubble is available on npm:

```bash
npm install @botbind/hubble
```

## Usage

```js
const Hubble = require('@botbind/hubble');

const gateway = Hubble.client('wss://gateway.discord.gg', {
    token: 'your_discord_bot_token',
});

gateway.onDispatch = function (event) {

    if (event === 'READY') {
        console.log('Gateway is ready');
    }
};

gateway.connect();
```
