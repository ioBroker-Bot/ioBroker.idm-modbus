import { fail, ok, type Result } from '../modbus/result';
import { WEB_STATISTICS } from './parse';

/** The only pages that are ever requested (all of them read-only). */
const ALLOWED_PAGES = new Set<string>([
    'rooms',
    'heatpump',
    'info',
    'settings',
    ...Object.values(WEB_STATISTICS).map(s => s.query),
]);

/** Settings of the web client. */
export interface WebClientOptions {
    /** host of the Navigator */
    host: string;
    /** HTTP port */
    port: number;
    /** the PIN of the display (never logged) */
    pin: string;
    /** timeout per request in ms */
    timeoutMs: number;
    /** replaceable for tests */
    fetchFn?: typeof fetch;
}

/**
 * Read-only client for the Navigator's local web interface (PHP pages behind the display PIN, seen on a Navigator Pro).
 * It logs in like the browser does (form field `pin`, session cookie, CSRF token from the page) and only ever sends GET
 * requests to `data/<name>.php` afterwards. Nothing here throws, errors carry no host and never the PIN (CLAUDE.md rules 3, 16).
 */
export class WebClient {
    private cookie = '';
    private csrf = '';
    private readonly fetchFn: typeof fetch;

    /**
     * @param options connection settings
     */
    public constructor(private readonly options: WebClientOptions) {
        this.fetchFn = options.fetchFn ?? fetch;
    }

    /** Forget the session; the next request logs in again. */
    public reset(): void {
        this.cookie = '';
        this.csrf = '';
    }

    /**
     * Read one data page as JSON (`rooms`, `heatpump`, `info`). Logs in first if needed, and once more if the session expired.
     *
     * @param name page name without path and extension (`rooms`), or a page with its query (`statistics.php?type=heatpump`)
     */
    public async getData(name: string): Promise<Result<unknown>> {
        if (!ALLOWED_PAGES.has(name)) {
            return fail('invalid', 'This page of the web interface is not read by the adapter');
        }
        for (let attempt = 0; attempt < 2; attempt++) {
            if (!this.csrf) {
                const login = await this.login();
                if (!login.ok) {
                    return login;
                }
            }
            const response = await this.request(
                'GET',
                `/data/${name.includes('.') ? name : `${name}.php`}`,
                undefined,
                { 'CSRF-Token': this.csrf },
            );
            if (!response.ok) {
                return response;
            }
            try {
                return ok(JSON.parse(response.value.body) as unknown);
            } catch {
                this.reset(); // not JSON: the login page came back, the session is gone
            }
        }
        return fail('protocol', 'The web interface did not answer with data after logging in');
    }

    private async login(): Promise<Result<void>> {
        this.reset();
        const start = await this.request('GET', '/enterpin.html');
        if (!start.ok) {
            return start;
        }
        const form = new URLSearchParams({ pin: this.options.pin }).toString();
        const page = await this.request('POST', '/index.php', form, {
            'Content-Type': 'application/x-www-form-urlencoded',
        });
        if (!page.ok) {
            return page;
        }
        const token = /csrf_token="([0-9a-zA-Z]+)"/.exec(page.value.body)?.[1];
        if (!token) {
            this.reset();
            return fail('protocol', 'Login to the web interface failed (wrong PIN?)');
        }
        this.csrf = token;
        return ok(undefined);
    }

    private async request(
        method: 'GET' | 'POST',
        path: string,
        body?: string,
        headers: Record<string, string> = {},
    ): Promise<Result<{ body: string }>> {
        try {
            const response = await this.fetchFn(`http://${this.options.host}:${this.options.port}${path}`, {
                method,
                body,
                redirect: 'manual',
                // AbortSignal.timeout needs no timer of ours (rule 17)
                signal: AbortSignal.timeout(this.options.timeoutMs),
                headers: { ...(this.cookie ? { Cookie: this.cookie } : {}), ...headers },
            });
            for (const setCookie of response.headers.getSetCookie?.() ?? []) {
                const pair = setCookie.split(';')[0];
                if (pair.startsWith('MYIDM=')) {
                    this.cookie = pair;
                }
            }
            // the login answers with status 302 and the page in the body; an expired session answers 302 with an empty body
            if (response.status < 200 || response.status >= 400) {
                return fail('protocol', `The web interface answered with status ${response.status}`);
            }
            return ok({ body: await response.text() });
        } catch (error) {
            const name = (error as { name?: string }).name;
            const aborted = name === 'AbortError' || name === 'TimeoutError';
            return fail(
                aborted ? 'timeout' : 'connect',
                aborted ? 'No response from the web interface' : 'The web interface is not reachable',
            );
        }
    }
}
