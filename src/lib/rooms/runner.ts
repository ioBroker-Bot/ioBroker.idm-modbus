import type { RoomSettings } from '../config';
import { ROOM_CONFLICT_AFTER, ROOM_TICK_MS, type FloatWordOrder } from '../constants';
import { checkWrite } from '../control/rules';
import type { Result } from '../modbus/result';
import type { RegisterEntry } from '../registers/types';
import { interpretWords } from '../value';
import { decideRoomWrite, type LastRoomWrite } from './engine';

/** What the runner needs from the adapter; a fake in the tests. */
export interface RoomHost {
    /** clock in ms */
    now(): number;
    /** log lines, never containing host names */
    log: { debug(message: string): void; info(message: string): void; warn(message: string): void };
    /** managed timers */
    timers: { setInterval: (cb: () => void, ms: number) => unknown; clearInterval: (handle: unknown) => void };
    /** the Navigator connection is up */
    connected(): boolean;
    /** read holding registers */
    read(address: number, count: number): Promise<Result<number[]>>;
    /** write holding registers (FC16) */
    write(address: number, words: readonly number[]): Promise<Result<void>>;
    /** subscribe to a foreign state */
    subscribe(stateId: string): void;
    /** current value of a foreign state */
    foreignState(stateId: string): Promise<{ val: unknown; ts: number } | null>;
    /** publish `rooms.writer_conflict` and `rooms.last_write` */
    publish(id: 'writer_conflict' | 'last_write', value: boolean | number): void;
}

/** Settings of the runner. */
export interface RoomOptions {
    /** room settings */
    settings: { sources: RoomSettings['sources'] };
    /** registers of the family */
    registers: readonly RegisterEntry[];
    /** FLOAT word order */
    floatWordOrder: FloatWordOrder;
}

/**
 * Feeds the room temperature of heating circuits from foreign states (spec Modul C, target 1). A value is written when it
 * changed by the tolerance and otherwise at the heartbeat; after each write the register is read back to find a second writer.
 */
export class RoomRunner {
    private timer: unknown;
    private busy = false;
    private conflict = false;
    private readonly inputs = new Map<string, { val: unknown; ts: number }>();
    private readonly last = new Map<string, LastRoomWrite>();
    private readonly mismatches = new Map<string, number>();
    private readonly warned = new Set<string>();

    /**
     * @param host adapter services
     * @param options settings and registers
     */
    public constructor(
        private readonly host: RoomHost,
        private readonly options: RoomOptions,
    ) {}

    private register(registerId: string): RegisterEntry | undefined {
        return this.options.registers.find(reg => reg.id === registerId);
    }

    /** Subscribe to the sources, read their current values and start the cycle. */
    public async start(): Promise<void> {
        for (const source of this.options.settings.sources) {
            this.host.subscribe(source.stateId);
            try {
                const state = await this.host.foreignState(source.stateId);
                if (state) {
                    this.inputs.set(source.stateId, state);
                }
            } catch {
                // the subscription delivers it later
            }
        }
        this.host.publish('writer_conflict', false);
        this.timer = this.host.timers.setInterval(() => void this.tick(), ROOM_TICK_MS);
        this.host.log.info(`Feeding started for ${this.options.settings.sources.length} registers`);
    }

    /** Stop the cycle. */
    public stop(): void {
        if (this.timer !== undefined) {
            this.host.timers.clearInterval(this.timer);
            this.timer = undefined;
        }
    }

    /**
     * A subscribed foreign state changed.
     *
     * @param stateId foreign state id
     * @param state its new state
     */
    public onForeignState(stateId: string, state: { val: unknown; ts: number } | null | undefined): void {
        if (state && this.options.settings.sources.some(s => s.stateId === stateId)) {
            this.inputs.set(stateId, state);
        }
    }

    /** One pass over all rows. Never throws. */
    public async tick(): Promise<void> {
        if (this.busy || !this.host.connected()) {
            return;
        }
        this.busy = true;
        try {
            for (const source of this.options.settings.sources) {
                const reg = this.register(source.registerId);
                if (!reg) {
                    continue;
                }
                const now = this.host.now();
                const decision = decideRoomWrite(
                    source,
                    this.inputs.get(source.stateId),
                    now,
                    this.last.get(source.registerId),
                );
                if ('skip' in decision) {
                    this.noteSkip(source.registerId, decision.skip);
                    continue;
                }
                this.warned.delete(`${source.registerId}:stale`);
                const check = checkWrite(reg, decision.write, {
                    current: () => undefined,
                    floatWordOrder: this.options.floatWordOrder,
                });
                if (!check.ok) {
                    this.host.log.warn(`Room temperature of ${source.registerId} refused: ${check.message}`);
                    continue;
                }
                const result = await this.host.write(reg.address, check.words);
                if (!result.ok) {
                    this.host.log.debug(
                        `Room temperature write of ${source.registerId} failed: ${result.error.message}`,
                    );
                    return;
                }
                this.last.set(source.registerId, { value: check.value, at: now });
                this.host.publish('last_write', now);
                await this.readBack(source.registerId, reg, check.value);
            }
        } catch (error) {
            this.host.log.debug(`Room cycle failed: ${(error as Error).message}`);
        } finally {
            this.busy = false;
        }
    }

    private noteSkip(registerId: string, reason: 'invalid' | 'stale' | 'range' | 'unchanged'): void {
        if (reason === 'unchanged') {
            return;
        }
        const key = `${registerId}:${reason}`;
        if (!this.warned.has(key)) {
            this.warned.add(key);
            const text = {
                invalid: 'is missing or not a number',
                stale: 'is too old',
                range: 'is outside the allowed range',
            }[reason];
            this.host.log.warn(`The source of ${registerId} ${text}, nothing is written`);
        }
    }

    private async readBack(registerId: string, reg: RegisterEntry, expected: number): Promise<void> {
        const result = await this.host.read(reg.address, reg.words);
        if (!result.ok) {
            return;
        }
        const decoded = interpretWords(reg, result.value, this.options.floatWordOrder);
        const different = decoded.value === null || Math.abs(decoded.value - expected) > 0.15;
        const count = different ? (this.mismatches.get(registerId) ?? 0) + 1 : 0;
        this.mismatches.set(registerId, count);
        const conflict = [...this.mismatches.values()].some(n => n >= ROOM_CONFLICT_AFTER);
        if (conflict !== this.conflict) {
            this.conflict = conflict;
            this.host.publish('writer_conflict', conflict);
            if (conflict) {
                this.host.log.warn(
                    `${registerId} keeps changing after it was written: another program seems to write it too`,
                );
            }
        }
    }
}
