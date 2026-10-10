import { localized } from '../translations';
import type { PlannedObject } from '../object-tree';
import type { Result } from '../modbus/result';
import {
    parseCircuitNames,
    parseRooms,
    parseStatistics,
    WEB_STATISTICS,
    type WebRoom,
    type WebStatistics,
    type WebStatisticsKind,
} from './parse';
import { buildStatisticsStates } from './statistics';

/** How often the heating circuit names are read again (they hardly ever change). */
const CIRCUIT_NAMES_EVERY_MS = 3600000;

/** What the runner needs from the adapter; a fake in the tests. */
export interface WebHost {
    /** clock in ms */
    now(): number;
    /** log lines, never containing the host or the PIN */
    log: { debug(message: string): void; info(message: string): void; warn(message: string): void };
    /** managed timers */
    timers: { setInterval: (cb: () => void, ms: number) => unknown; clearInterval: (handle: unknown) => void };
    /** read a data page of the web interface */
    getData(name: string): Promise<Result<unknown>>;
    /** wait (managed timer), to pace the requests */
    sleep(ms: number): Promise<void>;
    /** create channels and states */
    createObjects(objects: PlannedObject[]): Promise<void>;
    /** set a state (acknowledged) */
    publish(id: string, value: string | number | boolean | null): void;
    /** give the channel of a zone room the name from the Navigator */
    setRoomName(zone: number, room: number, name: string): void;
    /** give the channel of a heating circuit the name from the Navigator (the adapter ignores it where the user named it) */
    setCircuitName(letter: string, name: string): void;
}

/** Settings of the runner. */
export interface WebOptions {
    /** poll interval in ms */
    intervalMs: number;
    /** interval of the statistics pages in ms, 0 = not read */
    statisticsIntervalMs: number;
}

/**
 * Reads the room data and the names from the Navigator's web interface in a fixed interval (spec Modul H). Read-only.
 */
export class WebRunner {
    private timer: unknown;
    private statisticsTimer: unknown;
    private statisticsBusy = false;
    private statisticsObjects = new Set<string>();
    private busy = false;
    private known = new Set<number>();
    private namesAt = Number.NEGATIVE_INFINITY;
    private failing = false;

    /**
     * @param host adapter services
     * @param options settings
     */
    public constructor(
        private readonly host: WebHost,
        private readonly options: WebOptions,
    ) {}

    /** Create the base objects, read once and start the cycle. */
    public async start(): Promise<void> {
        await this.host.createObjects([
            this.channel('web', 'Web interface'),
            this.channel('web.rooms', 'Rooms'),
            this.state('web.connected', 'Web interface reachable', 'boolean', 'indicator.reachable'),
        ]);
        await this.tick();
        this.timer = this.host.timers.setInterval(() => void this.tick(), this.options.intervalMs);
        if (this.options.statisticsIntervalMs > 0) {
            await this.statisticsTick();
            this.statisticsTimer = this.host.timers.setInterval(
                () => void this.statisticsTick(),
                this.options.statisticsIntervalMs,
            );
        }
        this.host.log.info(`Web interface module started, every ${this.options.intervalMs / 1000} s`);
    }

    /** Stop the cycle. */
    public stop(): void {
        if (this.timer !== undefined) {
            this.host.timers.clearInterval(this.timer);
            this.timer = undefined;
        }
        if (this.statisticsTimer !== undefined) {
            this.host.timers.clearInterval(this.statisticsTimer);
            this.statisticsTimer = undefined;
        }
    }

    /** Read the three statistics pages one after the other and publish them. Never throws. */
    public async statisticsTick(): Promise<void> {
        if (this.statisticsBusy) {
            return;
        }
        this.statisticsBusy = true;
        try {
            const tables: Partial<Record<WebStatisticsKind, WebStatistics>> = {};
            for (const kind of Object.keys(WEB_STATISTICS) as WebStatisticsKind[]) {
                const answer = await this.host.getData(WEB_STATISTICS[kind].query);
                const table = answer.ok ? parseStatistics(answer.value) : null;
                if (table) {
                    tables[kind] = table;
                } else {
                    this.host.log.debug(`Web statistics ${kind} could not be read`);
                }
                await this.host.sleep(1000);
            }
            const states = buildStatisticsStates(tables);
            const fresh = states.objects.filter(o => !this.statisticsObjects.has(o.id));
            if (fresh.length) {
                await this.host.createObjects(fresh);
                fresh.forEach(o => this.statisticsObjects.add(o.id));
            }
            states.values.forEach((value, id) => this.host.publish(id, value));
        } catch (error) {
            this.host.log.debug(`Web statistics failed: ${(error as Error).message}`);
        } finally {
            this.statisticsBusy = false;
        }
    }

    /** One pass: rooms always, circuit names now and then. Never throws. */
    public async tick(): Promise<void> {
        if (this.busy) {
            return;
        }
        this.busy = true;
        try {
            const rooms = await this.host.getData('rooms');
            if (!rooms.ok) {
                this.fail(rooms.error.message);
                return;
            }
            this.failing = false;
            this.host.publish('web.connected', true);
            await this.publishRooms(parseRooms(rooms.value));
            if (this.host.now() - this.namesAt >= CIRCUIT_NAMES_EVERY_MS) {
                const heatpump = await this.host.getData('heatpump');
                if (heatpump.ok) {
                    this.namesAt = this.host.now();
                    for (const [letter, name] of Object.entries(parseCircuitNames(heatpump.value))) {
                        this.host.setCircuitName(letter, name);
                    }
                }
            }
        } catch (error) {
            this.fail((error as Error).message);
        } finally {
            this.busy = false;
        }
    }

    private fail(message: string): void {
        this.host.publish('web.connected', false);
        if (!this.failing) {
            this.failing = true;
            this.host.log.warn(`Web interface: ${message}`);
        } else {
            this.host.log.debug(`Web interface: ${message}`);
        }
    }

    private async publishRooms(rooms: WebRoom[]): Promise<void> {
        const fresh = rooms.filter(room => !this.known.has(room.id));
        if (fresh.length) {
            await this.host.createObjects(
                fresh.flatMap(room => {
                    const base = `web.rooms.${room.id}`;
                    return [
                        this.channel(base, room.name, false),
                        this.state(`${base}.name`, 'Room name', 'string', 'text'),
                        this.state(`${base}.mode`, 'Operating mode', 'string', 'text'),
                        this.state(`${base}.temperature`, 'Room temperature', 'number', 'value.temperature', '°C'),
                        this.state(`${base}.target`, 'Target temperature', 'number', 'value.temperature', '°C'),
                        this.state(`${base}.humidity`, 'Room humidity', 'number', 'value.humidity', '%'),
                    ];
                }),
            );
            fresh.forEach(room => this.known.add(room.id));
        }
        for (const room of rooms) {
            const base = `web.rooms.${room.id}`;
            this.host.publish(`${base}.name`, room.name);
            this.host.publish(`${base}.mode`, room.mode);
            this.host.publish(`${base}.temperature`, room.actual);
            this.host.publish(`${base}.target`, room.target);
            this.host.publish(`${base}.humidity`, room.humidity);
            if (room.zone !== null && room.room !== null) {
                this.host.setRoomName(room.zone, room.room, room.name);
            }
        }
    }

    private channel(id: string, name: string, translate = true): PlannedObject {
        return {
            id,
            object: { type: 'channel', common: { name: translate ? localized(name) : name }, native: {} },
        };
    }

    private state(
        id: string,
        name: string,
        type: 'boolean' | 'string' | 'number',
        role: string,
        unit?: string,
    ): PlannedObject {
        return {
            id,
            object: {
                type: 'state',
                common: { name: localized(name), type, role, read: true, write: false, ...(unit ? { unit } : {}) },
                native: {},
            },
        };
    }
}
