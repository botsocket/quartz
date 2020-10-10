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

const gateway = Quartz.client('wss://gateway.discord.gg', {
    token: 'your_discord_bot_token',
});

gateway.onDispatch = function (event) {

    if (event === 'READY') {
        console.log('Gateway is ready');
    }
};

gateway.connect();
```
