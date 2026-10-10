import { expect } from 'chai';
import type { RoomSettings } from '../config';
import { ROOM_TICK_MS } from '../constants';
import { loadRegisters } from '../registers/plant';
import type { RegisterEntry } from '../registers/types';
import { RoomRunner, type RoomHost } from './runner';

const nav20 = loadRegisters('nav20') as RegisterEntry[];
const NOW = 8_000_000;
const settings: RoomSettings = {
    enabled: true,
    warnings: [],
    sources: [
        {
            circuit: 'A',
            registerId: 'hc_a_ext_room_temp',
            stateId: 'room.a',
            factor: 1,
            offset: 0,
            heartbeatMs: 300000,
            toleranceC: 0.2,
            min: 15,
            max: 30,
            maxAgeMs: 900000,
            onStale: 'stop',
            fixedValue: null,
        },
    ],
};

class Fake implements RoomHost {
    public time = NOW;
    public online = true;
    public memory = new Map<number, number>();
    public writes: { address: number; words: number[] }[] = [];
    public logs: string[] = [];
    public published: Record<string, boolean | number> = {};
    public foreignWriter = false;
    public log = {
        debug: (m: string): void => void this.logs.push(`debug ${m}`),
        info: (m: string): void => void this.logs.push(`info ${m}`),
        warn: (m: string): void => void this.logs.push(`warn ${m}`),
    };
    public timers = { setInterval: (): unknown => 1, clearInterval: (): void => {} };
    public now = (): number => this.time;
    public connected = (): boolean => this.online;
    public subscribe = (): void => {};
    public foreignState = (): Promise<{ val: unknown; ts: number } | null> => Promise.resolve({ val: 21.3, ts: NOW });
    public publish = (id: string, value: boolean | number): void => {
        this.published[id] = value;
    };
    public read = (address: number, count: number): ReturnType<RoomHost['read']> =>
        Promise.resolve({
            ok: true,
            value: Array.from({ length: count }, (_, i) =>
                this.foreignWriter ? 0 : (this.memory.get(address + i) ?? 0),
            ),
        });
    public write = (address: number, words: readonly number[]): ReturnType<RoomHost['write']> => {
        this.writes.push({ address, words: [...words] });
        words.forEach((w, i) => this.memory.set(address + i, w));
        return Promise.resolve({ ok: true, value: undefined });
    };
}

const make = async (host: Fake): Promise<RoomRunner> => {
    const runner = new RoomRunner(host, { settings, registers: nav20, floatWordOrder: 'lowFirst' });
    await runner.start();
    return runner;
};

describe('RoomRunner', () => {
    it('writes the temperature to the external room temperature of the heating circuit (1650 for circuit A), then only on change or heartbeat', async () => {
        const host = new Fake();
        const runner = await make(host);
        await runner.tick();
        expect(host.writes).to.deep.equal([{ address: 1650, words: [0x6666, 0x41aa] }]); // 21.3 as FLOAT, low word first
        host.time += ROOM_TICK_MS;
        await runner.tick();
        expect(host.writes).to.have.length(1);
        runner.onForeignState('room.a', { val: 21.6, ts: host.time });
        await runner.tick();
        expect(host.writes).to.have.length(2);
        host.time += 301000;
        runner.onForeignState('room.a', { val: 21.6, ts: host.time });
        await runner.tick();
        expect(host.writes).to.have.length(3);
        expect(host.published.last_write).to.equal(host.time);
    });

    it('warns once about an old source and writes nothing', async () => {
        const host = new Fake();
        const runner = await make(host);
        host.time = NOW + 2000000;
        await runner.tick();
        await runner.tick();
        expect(host.writes).to.deep.equal([]);
        expect(host.logs.filter(l => l.startsWith('warn') && l.includes('too old'))).to.have.length(1);
    });

    it('does not write while offline', async () => {
        const host = new Fake();
        const runner = await make(host);
        host.online = false;
        await runner.tick();
        expect(host.writes).to.deep.equal([]);
    });

    it('reports another writer when the read-back keeps differing', async () => {
        const host = new Fake();
        const runner = await make(host);
        host.foreignWriter = true;
        for (let i = 0; i < 3; i++) {
            runner.onForeignState('room.a', { val: 21 + i, ts: host.time });
            await runner.tick();
        }
        expect(host.published.writer_conflict).to.equal(true);
        expect(host.logs.filter(l => l.includes('another program'))).to.have.length(1);
    });
});
