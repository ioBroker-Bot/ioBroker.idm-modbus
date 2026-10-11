import { fail, ok, type Result } from '../modbus/result';

/** The parts of a WebSocket the client uses: the global one of Node, a fake in the tests. */
export interface SocketLike {
    /** the connection is open */
    onopen: (() => void) | null;
    /** a frame arrived */
    onmessage: ((event: { data: unknown }) => void) | null;
    /** the connection ended */
    onclose: (() => void) | null;
    /** the connection failed */
    onerror: (() => void) | null;
    /** send a text frame */
    send(data: string): void;
    /** close the connection */
    close(): void;
}

/** Settings of the client. */
export interface Nav10ClientOptions {
    /** host of the Navigator */
    host: string;
    /** WebSocket port (61220) */
    port: number;
    /** the PIN of the display (never logged) */
    pin: string;
    /** timeout per step in ms */
    timeoutMs: number;
    /** replaceable for tests */
    createSocket?: (url: string) => SocketLike;
}

/** Waits for the next text frame; knows when the connection ended. */
class Inbox {
    private readonly queue: string[] = [];
    private waiter: ((frame: Result<string>) => void) | null = null;
    private ended = false;

    /**
     * A frame arrived.
     *
     * @param text the frame
     */
    public push(text: string): void {
        if (this.waiter) {
            const waiter = this.waiter;
            this.waiter = null;
            waiter(ok(text));
        } else {
            this.queue.push(text);
        }
    }

    /** The connection ended. */
    public end(): void {
        this.ended = true;
        const waiter = this.waiter;
        this.waiter = null;
        waiter?.(fail('offline', 'The Navigator closed the connection'));
    }

    /**
     * The next frame, a failure when none comes in time or the connection ended.
     *
     * @param timeoutMs how long to wait
     */
    public next(timeoutMs: number): Promise<Result<string>> {
        const queued = this.queue.shift();
        if (queued !== undefined) {
            return Promise.resolve(ok(queued));
        }
        if (this.ended) {
            return Promise.resolve(fail('offline', 'The Navigator closed the connection'));
        }
        return new Promise(resolve => {
            const signal = AbortSignal.timeout(timeoutMs); // needs no timer of ours (rule 17)
            const onAbort = (): void => {
                this.waiter = null;
                resolve(fail('timeout', 'No answer from the Navigator'));
            };
            signal.addEventListener('abort', onAbort, { once: true });
            this.waiter = frame => {
                signal.removeEventListener('abort', onAbort);
                resolve(frame);
            };
        });
    }
}

/**
 * Read-only client for the local WebSocket of the Navigator 10 (port 61220, the display PIN as `auth_code` in the URL). It asks for
 * one setting after the other and gets the same HTML tables as the PHP pages of the Navigator 2.0. The protocol is the one
 * Xerolux documents and uses in idm-heatpump-api (MIT). Nothing here throws, errors carry no host and never the PIN (rules 3, 16).
 */
export class Nav10Client {
    private socket: SocketLike | null = null;
    private inbox = new Inbox();
    private queue: Promise<unknown> = Promise.resolve();

    /**
     * @param options connection settings
     */
    public constructor(private readonly options: Nav10ClientOptions) {}

    /**
     * Read one setting page.
     *
     * @param settingId the setting id (4768 = sensors, 4775 = digital inputs, ...)
     * @returns the HTML of the page (its table), or a failure
     */
    public getSetting(settingId: string): Promise<Result<string>> {
        const run = this.queue.then(() => this.requestSetting(settingId));
        this.queue = run.catch(() => undefined);
        return run;
    }

    /** Close the connection. */
    public close(): void {
        this.drop();
    }

    private drop(): void {
        const socket = this.socket;
        this.socket = null;
        if (socket) {
            socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
            try {
                socket.close();
            } catch {
                /* already closed */
            }
        }
        this.inbox.end();
        this.inbox = new Inbox();
    }

    private async requestSetting(settingId: string): Promise<Result<string>> {
        try {
            const connected = await this.connect();
            if (!connected.ok) {
                return connected;
            }
            this.socket?.send(JSON.stringify({ controller: 'setting', command: 'detail', data: { settingId } }));
            const frame = await this.inbox.next(this.options.timeoutMs);
            if (!frame.ok) {
                this.drop();
                return frame;
            }
            return this.parseSetting(frame.value, settingId);
        } catch {
            this.drop();
            return fail('connect', 'The Navigator is not reachable');
        }
    }

    private parseSetting(text: string, settingId: string): Result<string> {
        let payload: unknown;
        try {
            payload = JSON.parse(text);
        } catch {
            return fail('protocol', 'The Navigator answered with something that is not JSON');
        }
        const detail = (payload as { settingDetail?: { value?: unknown } } | null)?.settingDetail;
        if (typeof detail?.value === 'string') {
            return ok(detail.value);
        }
        // pages this plant does not have answer with a note instead; that is not a failure of the connection
        return fail('invalid', `The setting page ${settingId} is not available`);
    }

    /** Open the connection and log in with the PIN, unless it is open already. */
    private async connect(): Promise<Result<void>> {
        if (this.socket) {
            return ok(undefined);
        }
        const url = `ws://${this.options.host}:${this.options.port}/?auth_code=${encodeURIComponent(this.options.pin)}`;
        const socket = this.options.createSocket
            ? this.options.createSocket(url)
            : new (globalThis as unknown as { WebSocket: new (url: string) => SocketLike }).WebSocket(url);
        this.socket = socket;
        const inbox = this.inbox;
        const opened = new Promise<Result<void>>(resolve => {
            socket.onopen = () => resolve(ok(undefined));
            socket.onerror = () => resolve(fail('connect', 'The Navigator is not reachable'));
            socket.onclose = () => {
                resolve(fail('connect', 'The Navigator closed the connection'));
                inbox.end();
            };
            const signal = AbortSignal.timeout(this.options.timeoutMs);
            signal.addEventListener('abort', () => resolve(fail('timeout', 'The Navigator did not answer')), {
                once: true,
            });
        });
        const state = await opened;
        if (!state.ok) {
            this.drop();
            return state;
        }
        socket.onmessage = event => inbox.push(String(event.data));
        socket.onclose = () => {
            if (this.socket === socket) {
                this.socket = null;
            }
            inbox.end();
        };
        const auth = await inbox.next(this.options.timeoutMs);
        if (!auth.ok) {
            this.drop();
            return auth;
        }
        let authorized: unknown;
        try {
            authorized = (JSON.parse(auth.value) as { authorized?: unknown }).authorized;
        } catch {
            authorized = undefined;
        }
        if (authorized !== true) {
            this.drop();
            return fail(
                'protocol',
                authorized === false ? 'The Navigator rejected the PIN' : 'The Navigator did not recognise the login',
            );
        }
        return ok(undefined);
    }
}
