import * as Quartz from '../src';

let strType: string;
let numType: number;
let numOrNullType: number | null;
let unknownType: unknown;

const client = Quartz.client('test', {
    token: 'test',
    id: 'test',
    shard: [0, 1],
    intents: ['GUILDS', 'DIRECT_MESSAGES', 1],
    reconnect: {
        delay: 1000,
        maxDelay: 5000,
        attempts: Infinity,
    },
});

client.connect().then();
client.disconnect().then();

strType = client.id;
numOrNullType = client.intents;
const shard = client.shard;
strType = client.url;

client.onError = function (error) {

    strType = error.message;
};

client.onDisconnect = function (info) {

    const code = info.code;
    const reason = info.reason;
    const explanation = info.explanation;
};

client.onDispatch = function (event, data) {

    strType = event;
    unknownType = data;
};


