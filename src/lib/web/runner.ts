import { localized } from '../translations';
import type { PlannedObject } from '../object-tree';
import { ManagedObjects, type ObjectHost } from './managed';
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
import { buildIoStates, circuitSensorTags, parseIo, type WebFacts } from './io';
import { buildStatisticsStates } from './statistics';

/** How often the heating circuit names are read again (they hardly ever change). */
const CIRCUIT_NAMES_EVERY_MS = 3600000;

/** What the runner needs from the adapter; a fake in the tests. */
export interface WebHost extends ObjectHost {
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
    /** set a state (acknowledged) */
    publish(id: string, value: string | number | boolean | null): void;
    /** give the channel of a zone room the name from the Navigator */
    setRoomName(zone: number, room: number, name: string): void;
    /** does Modbus deliver a value for the part with this IDM tag (B33, M73, ...)? The web copy is not needed then. */
    hasModbusValue(tag: string): boolean;
    /** does Modbus deliver the temperature of this zone room? The web copy of the room's values is not needed then. */
    hasModbusRoom(zone: number, room: number): boolean;
    /** the sensors and circuit sensor tags of the sensor table (for the diagram), called when they change */
    setWebFacts(facts: WebFacts): void;
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
    private readonly ioObjects: ManagedObjects;
    private readonly roomObjects: ManagedObjects;
    private ioValues = new Map<string, number | string | boolean>();
    private readonly facts: WebFacts = { circuitTags: {}, sensors: [] };
    private readonly roomNameStates = new Set<string>();
    private factsJson = '';
    private busy = false;
    private namesAt = Number.NEGATIVE_INFINITY;
    private failing = false;

    /**
     * @param host adapter services
     * @param options settings
     */
    public constructor(
        private readonly host: WebHost,
        private readonly options: WebOptions,
    ) {
        this.ioObjects = new ManagedObjects(host, 'web.io');
        this.roomObjects = new ManagedObjects(host, 'web.rooms');
    }

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
            await this.publishIo();
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

    /** Inputs and outputs (sensors, digital inputs, analog and digital outputs) from the settings tree; a failure only skips them. */
    private async publishIo(): Promise<void> {
        const settings = await this.host.getData('settings');
        if (!settings.ok) {
            this.host.log.debug(`Web inputs and outputs could not be read: ${settings.error.message}`);
            return;
        }
        const io = parseIo(settings.value);
        const states = buildIoStates(io, tag => this.host.hasModbusValue(tag));
        await this.ioObjects.sync(states.objects);
        for (const id of this.ioValues.keys()) {
            if (!states.values.has(id)) {
                this.ioValues.delete(id); // no longer created: publish it again if it comes back
            }
        }
        states.values.forEach((value, id) => {
            if (this.ioValues.get(id) !== value) {
                this.ioValues.set(id, value);
                this.host.publish(id, value);
            }
        });
        this.facts.sensors = states.sensors;
        this.facts.circuitTags = {};
        for (const { letter, kind, tag } of circuitSensorTags(io.sensors ?? [])) {
            this.facts.circuitTags[letter] = { ...this.facts.circuitTags[letter], [kind]: tag };
        }
        this.emitFacts();
    }

    /** Hand what the diagram needs to the adapter, but only when it changed. */
    private emitFacts(): void {
        const json = JSON.stringify(this.facts);
        if (json !== this.factsJson) {
            this.factsJson = json;
            this.host.setWebFacts(JSON.parse(json) as WebFacts);
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

    /**
     * Rooms Modbus delivers keep only their name here (the room's values are the Modbus ones); the others get all their values.
     *
     * @param room the room of the web interface
     */
    private viaModbus(room: WebRoom): boolean {
        return room.zone !== null && room.room !== null && this.host.hasModbusRoom(room.zone, room.room);
    }

    private roomObjectsOf(room: WebRoom): PlannedObject[] {
        if (this.viaModbus(room)) {
            return [];
        }
        const base = `web.rooms.${room.id}`;
        return [
            this.channel(base, room.name, false),
            this.state(`${base}.name`, 'Room name', 'string', 'text'),
            this.state(`${base}.mode`, 'Operating mode', 'string', 'text'),
            this.state(`${base}.temperature`, 'Room temperature', 'number', 'value.temperature', '°C'),
            this.state(`${base}.target`, 'Target temperature', 'number', 'value.temperature', '°C'),
            this.state(`${base}.humidity`, 'Room humidity', 'number', 'value.humidity', '%'),
        ];
    }

    /**
     * The name of a room Modbus reads becomes a state `zones.<Z>.rooms.<R>.name` (and the name of its channel), the other rooms get
     * all their values under `web.rooms`.
     *
     * @param rooms the rooms of the web interface
     */
    private async publishRooms(rooms: WebRoom[]): Promise<void> {
        await this.roomObjects.sync(rooms.flatMap(room => this.roomObjectsOf(room)));
        for (const room of rooms) {
            if (room.zone !== null && room.room !== null) {
                await this.publishRoomName(room.zone, room.room, room.name);
            }
            if (!this.viaModbus(room)) {
                const base = `web.rooms.${room.id}`;
                this.host.publish(`${base}.name`, room.name);
                this.host.publish(`${base}.mode`, room.mode);
                this.host.publish(`${base}.temperature`, room.actual);
                this.host.publish(`${base}.target`, room.target);
                this.host.publish(`${base}.humidity`, room.humidity);
            }
        }
    }

    /**
     * Name the channel of a zone room and, where Modbus reads the room, give it a name state.
     *
     * @param zone zone module number
     * @param room room number in the module
     * @param name the name from the Navigator
     */
    private async publishRoomName(zone: number, room: number, name: string): Promise<void> {
        this.host.setRoomName(zone, room, name);
        if (!this.host.hasModbusRoom(zone, room)) {
            return;
        }
        const id = `zones.${zone}.rooms.${room}.name`;
        if (!this.roomNameStates.has(id)) {
            await this.host.createObjects([this.state(id, 'Room name', 'string', 'text')]);
            this.roomNameStates.add(id);
        }
        this.host.publish(id, name);
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
