# Documentation

## Introduction

Hubble is a library that simplies Discord gateway connection.

## Installation

Hubble is available on npm:

```bash
npm install @botbind/hubble
```

## Usage

```js
const Hubble = require('@botbind/hubble');

const gateway = Hubble.connect();

gateway.events.on('ready', () => {

    console.log('Gateway is ready');
});
```
