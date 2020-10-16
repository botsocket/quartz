export { };

/**
 * Creates a Gateway client where:
 *
 * @param url - The gateway URL. Must be passed explicitly. This allows the URL to be cached as requested [here](https://discord.com/developers/docs/topics/gateway#get-gateway)
 * @param options - Connection options.
 */
export function client(url: string, options: Options): internals.Client;

export type Intents =
    'GUILDS' |
    'GUILD_MEMBERS' |
    'GUILD_BANS' |
    'GUILD_EMOJIS' |
    'GUILD_INTEGRATIONS' |
    'GUILD_WEBHOOKS' |
    'GUILD_INVITES' |
    'GUILD_VOICE_STATES' |
    'GUILD_PRESENCES' |
    'GUILD_MESSAGES' |
    'GUILD_MESSAGE_REACTIONS' |
    'GUILD_MESSAGE_TYPING' |
    'DIRECT_MESSAGES' |
    'DIRECT_MESSAGE_REACTIONS' |
    'DIRECT_MESSAGE_TYPING';

export interface Options {
    /**
     * The authentication token.
     */
    readonly token: string;

    /**
     * The session id to resume connection.
     */
    readonly id?: string;

    /**
     * A tuple containing sharding information. The first item is the current shard id and the second item is the total number of shards. Defaults to `[0, 1]`
     *
     * @default [0, 1]
     */
    readonly shard?: [number, number];

    /**
     * [Gateway intents](https://discord.com/developers/docs/topics/gateway#gateway-intents).
     */
    readonly intents?: number | Intents | (number | Intents)[];

    /**
     * Reconnection options
     */
    readonly reconnect?: false | {
        /**
         * The number of reconnection attempts.
         *
         * @default Infinity
         */
        readonly attempts?: number;

        /**
         * The amount of time in milliseconds to backoff before reconnecting.
         *
         * @default 1000
         */
        readonly delay?: number;

        /**
         * The maximum amount of time in milliseconds to backoff before reconnecting.
         *
         * @default 5000
         */
        readonly maxDelay?: number;
    };
}

declare namespace internals {
    class Client {
        /**
         * Discord gateway url used to establish the connection.
         */
        url: string;

        /**
         * Sharding information.
         */
        shard: [number, number];

        /**
         * Resolved intents.
         */
        intents: number | null;

        /**
         * Listener invoked whenever the connection is closed, including closures before establishing reconnections.
         */
        onDisconnect: DisconnectListener;

        /**
         * Listener invoked whenever an error is encountered.
         */
        onError: ErrorListener;

        /**
         * Listener invoked when Discord replies with the [dispatch event](https://discord.com/developers/docs/topics/gateway#sending-payloads-example-gateway-dispatch).
         */
        onDispatch: DispatchListener;

        /**
         * Session id.
         */
        id: string;

        /**
         * Connects to Discord Gateway API. Returns a promise that when resolved signifies a successful connection.
         */
        connect(): Promise<void>;

        /**
         * Closes the connection to Discord Gateway API and performs necessary cleanup. Returns a promise that when resolved signifies a successful disconnection.
         */
        disconnect(): Promise<void>;

        /**
         * Sends a payload to Discord Gateway API where:
         *
         * @param payload - The payload to send. Will call `JSON.stringify()` automatically.
         */
        send(payload: unknown): void;
    }

    type DisconnectListener = (info: { code?: number, reason?: string; explanation?: string }) => void;
    type ErrorListener = (error: Error) => void;
    type DispatchListener = (event: string, data: unknown) => void;
}
