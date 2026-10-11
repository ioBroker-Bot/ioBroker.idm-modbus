import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { fail, ok, type Result } from '../modbus/result';
import type { ValueHub } from './hub';
import type { DiagramModel } from './model';

/** The files of the page; they are read once at the start, so no request can name a file. */
const FILES: Record<string, { file: string; type: string }> = {
    '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
    '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
    '/diagram.js': { file: 'diagram.js', type: 'text/javascript; charset=utf-8' },
    '/diagram.css': { file: 'diagram.css', type: 'text/css; charset=utf-8' },
    '/favicon.png': { file: 'favicon.png', type: 'image/png' },
};

/** At most this many pages listen at the same time. */
const MAX_CLIENTS = 20;
/** A comment line keeps idle event streams open through proxies. */
const HEARTBEAT_MS = 25000;

/** Settings and services of the server. */
export interface DiagramServerOptions {
    /** TCP port, 0 = a free one (tests) */
    port: number;
    /** address to listen on */
    bind: string;
    /** folder with the page files */
    wwwDir: string;
    /** the values */
    hub: ValueHub;
    /** the current model of the diagram */
    model(): DiagramModel;
    /** managed timers */
    timers: { setInterval: (cb: () => void, ms: number) => unknown; clearInterval: (handle: unknown) => void };
    /** log lines */
    log: { debug(message: string): void; warn(message: string): void };
}

/**
 * A small read-only web server for the heat pump diagram: the page, the model of the installation as JSON and the live values as
 * server-sent events. It answers only GET and HEAD, serves nothing but its own four files and never throws past its boundary.
 */
export class DiagramServer {
    private server: http.Server | null = null;
    private readonly files = new Map<string, { body: Buffer; type: string }>();
    private readonly clients = new Set<http.ServerResponse>();
    private unsubscribe: (() => void) | null = null;
    private heartbeat: unknown;
    /** the state ids of the model built last: only their changes are sent to the pages */
    private watched = new Set<string>();

    /**
     * @param options settings and services
     */
    public constructor(private readonly options: DiagramServerOptions) {}

    /**
     * Start listening.
     *
     * @returns the port, or a failure (port in use, files missing)
     */
    public start(): Promise<Result<number>> {
        try {
            for (const [url, { file, type }] of Object.entries(FILES)) {
                const target = path.join(this.options.wwwDir, file);
                if (fs.existsSync(target)) {
                    this.files.set(url, { body: fs.readFileSync(target), type });
                }
            }
            if (!this.files.has('/')) {
                return Promise.resolve(fail('invalid', 'The files of the diagram page are missing'));
            }
        } catch {
            return Promise.resolve(fail('invalid', 'The files of the diagram page could not be read'));
        }
        return new Promise(resolve => {
            const server = http.createServer((req, res) => this.handle(req, res));
            server.on('error', error => {
                this.options.log.warn(`Diagram page: ${error.message}`);
                resolve(
                    fail(
                        'connect',
                        `The diagram page could not start: ${(error as NodeJS.ErrnoException).code ?? 'error'}`,
                    ),
                );
            });
            server.listen(this.options.port, this.options.bind, () => {
                this.server = server;
                this.unsubscribe = this.options.hub.subscribe((id, value) => this.broadcast(id, value));
                this.heartbeat = this.options.timers.setInterval(() => {
                    for (const client of this.clients) {
                        client.write(': keepalive\n\n');
                    }
                }, HEARTBEAT_MS);
                resolve(ok((server.address() as { port: number }).port));
            });
        });
    }

    /** Stop listening and close the open pages. */
    public async stop(): Promise<void> {
        this.unsubscribe?.();
        this.unsubscribe = null;
        if (this.heartbeat !== undefined) {
            this.options.timers.clearInterval(this.heartbeat);
            this.heartbeat = undefined;
        }
        for (const client of this.clients) {
            client.end();
        }
        this.clients.clear();
        const server = this.server;
        this.server = null;
        if (server) {
            await new Promise<void>(resolve => {
                server.close(() => resolve());
                server.closeAllConnections();
            });
        }
    }

    private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
        try {
            const headers = {
                'Cache-Control': 'no-store',
                'X-Content-Type-Options': 'nosniff',
                'Referrer-Policy': 'no-referrer',
                'Content-Security-Policy':
                    "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
            };
            if (req.method !== 'GET' && req.method !== 'HEAD') {
                res.writeHead(405, { ...headers, Allow: 'GET, HEAD' }).end();
                return;
            }
            const url = (req.url ?? '/').split('?')[0];
            const file = this.files.get(url);
            if (file) {
                res.writeHead(200, { ...headers, 'Content-Type': file.type }).end(
                    req.method === 'HEAD' ? undefined : file.body,
                );
            } else if (url === '/api/model') {
                const body = JSON.stringify(this.currentModel());
                res.writeHead(200, { ...headers, 'Content-Type': 'application/json; charset=utf-8' }).end(
                    req.method === 'HEAD' ? undefined : body,
                );
            } else if (url === '/events') {
                this.openStream(req, res, headers);
            } else {
                res.writeHead(404, headers).end();
            }
        } catch (error) {
            this.options.log.debug(`Diagram request failed: ${(error as Error).message}`);
            res.writeHead(500).end();
        }
    }

    private openStream(req: http.IncomingMessage, res: http.ServerResponse, headers: Record<string, string>): void {
        if (this.clients.size >= MAX_CLIENTS) {
            res.writeHead(503, headers).end();
            return;
        }
        res.writeHead(200, { ...headers, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
        const snapshot: Record<string, unknown> = {};
        for (const id of this.currentModel().watch) {
            const value = this.options.hub.get(id);
            if (value !== undefined) {
                snapshot[id] = value;
            }
        }
        res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
        this.clients.add(res);
        req.on('close', () => this.clients.delete(res));
    }

    /** Build the model and remember which states it listens to. */
    private currentModel(): DiagramModel {
        const model = this.options.model();
        this.watched = new Set(model.watch);
        return model;
    }

    private broadcast(id: string, value: unknown): void {
        if (!this.clients.size || !this.watched.has(id)) {
            return;
        }
        const message = `event: update\ndata: ${JSON.stringify({ [id]: value })}\n\n`;
        for (const client of this.clients) {
            client.write(message);
        }
    }
}
