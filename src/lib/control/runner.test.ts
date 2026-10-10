import { expect } from 'chai';
import { readControlSettings } from '../config';
import { ManualTimers } from '../manual-timers.test';
import { fail, ok, type Result } from '../modbus/result';
import { loadRegisters } from '../registers/plant';
import type { RegisterEntry } from '../registers/types';
import { ControlRunner, type ControlHost } from './runner';
import type { WriteCounters, WriteExecutor } from './scheduler';

const nav20 = loadRegisters('nav20') as RegisterEntry[];

class FakeHost implements ControlHost {
    public timers = new ManualTimers();
    public memory = new Map<number, number[]>();
    public online = true;
    public failWrites = false;
    public writes: { address: number; words: number[] }[] = [];
    public known = new Map<string, number>();
    public subscribed: string[] = [];
    public acknowledged: [string, number | boolean | null][] = [];
    public errors: string[] = [];
    public counters = new Map<string, WriteCounters>();
    public saved: string | null = null;
    public logs: string[] = [];
    public log = {
        debug: (m: string): void => void this.logs.push(`debug ${m}`),
        info: (m: string): void => void this.logs.push(`info ${m}`),
        warn: (m: string): void => void this.logs.push(`warn ${m}`),
    };
    public now = (): number => this.timers.time;
    public executor: WriteExecutor = {
        connected: () => this.online,
        read: (reg): Promise<Result<number[]>> =>
            Promise.resolve(ok(this.memory.get(reg.address) ?? Array.from({ length: reg.words }, () => 0))),
        write: (reg, words): Promise<Result<void>> => {
            if (this.failWrites) {
                return Promise.resolve(fail('timeout', 'No response'));
            }
            this.writes.push({ address: reg.address, words });
            this.memory.set(reg.address, words);
            return Promise.resolve(ok(undefined));
        },
    };
    public lastKnown = (id: string): number | undefined => this.known.get(id);
    public subscribe = (stateId: string): void => void this.subscribed.push(stateId);
    public acknowledge = (stateId: string, value: number | boolean | null): void =>
        void this.acknowledged.push([stateId, value]);
    public reportError = (message: string): void => void this.errors.push(message);
    public publishCounter = (id: string, counters: WriteCounters): void => void this.counters.set(id, counters);
    public loadCounters = (): Promise<string | null> => Promise.resolve(this.saved);
    public saveCounters = (json: string): void => {
        this.saved = json;
    };
}

const make = async (settings: Record<string, unknown>): Promise<{ host: FakeHost; runner: ControlRunner }> => {
    const host = new FakeHost();
    host.timers.time = Date.UTC(2026, 2, 10, 12, 0, 0);
    const runner = new ControlRunner(host, {
        registers: nav20,
        control: readControlSettings(settings),
        floatWordOrder: 'lowFirst',
        dateKey: ms => new Date(ms).toISOString().slice(0, 10),
    });
    await runner.start();
    return { host, runner };
};

describe('ControlRunner', () => {
    it('subscribes to nothing when control is off', async () => {
        const { host, runner } = await make({});
        expect(runner.writableCount).to.equal(0);
        expect(host.subscribed).to.deep.equal([]);
    });

    it('subscribes only to the states of the enabled groups', async () => {
        const { host } = await make({ writeSystem: true, writeHcA: true });
        expect(host.subscribed).to.include.members([
            'system.system_mode',
            'system.error_acknowledge',
            'hc.A.mode',
            'hc.A.heating_curve',
        ]);
        expect(host.subscribed.some(id => id.startsWith('hc.B'))).to.equal(false);
        expect(host.subscribed.some(id => id.startsWith('dhw.'))).to.equal(false);
    });

    it('writes a changed state, confirms it, counts it and saves the counters', async () => {
        const { host, runner } = await make({ writeSystem: true });
        runner.onStateChange('system.system_mode', { val: 2, ack: false });
        await host.timers.advance(3000);
        expect(host.writes).to.deep.equal([{ address: 1005, words: [2] }]);
        expect(host.acknowledged).to.deep.equal([['system.system_mode', 2]]);
        expect(host.counters.get('system_mode')).to.include({ total: 1 });
        expect(JSON.parse(host.saved as string).system_mode).to.include({ total: 1 });
    });

    it('ignores acknowledged states and states of groups that are not enabled', async () => {
        const { host, runner } = await make({ writeSystem: true });
        runner.onStateChange('system.system_mode', { val: 2, ack: true }); // our own update
        runner.onStateChange('dhw.dhw_setpoint', { val: 48, ack: false }); // dhw control is off
        runner.onStateChange('hp.hp_flow_temp', { val: 30, ack: false }); // read-only
        await host.timers.advance(5000);
        expect(host.writes).to.deep.equal([]);
    });

    it('refuses an invalid value, reports it and puts the state back to what the Navigator has', async () => {
        const { host, runner } = await make({ writeSystem: true });
        host.known.set('system_mode', 1);
        runner.onStateChange('system.system_mode', { val: 3, ack: false }); // 3 is not an allowed mode
        await host.timers.advance(100);
        expect(host.writes).to.deep.equal([]);
        expect(host.acknowledged).to.deep.equal([['system.system_mode', 1]]);
        expect(host.errors[0]).to.include('not one of the allowed values');
        expect(host.logs.some(l => l.startsWith('warn') && l.includes('system_mode'))).to.equal(true);
    });

    it('reports a failed write and shows the value the Navigator still has', async () => {
        const { host, runner } = await make({ writeDhw: true });
        host.known.set('dhw_setpoint', 46);
        host.failWrites = true;
        runner.onStateChange('dhw.dhw_setpoint', { val: 48, ack: false });
        await host.timers.advance(3000);
        expect(host.acknowledged).to.deep.equal([['dhw.dhw_setpoint', 46]]);
        expect(host.errors[0]).to.include('write failed');
        expect(host.counters.size).to.equal(0);
    });

    it('does not write while the Navigator is unreachable and shows the last known value again', async () => {
        const { host, runner } = await make({ writeSolar: true });
        host.online = false;
        host.known.set('solar_mode', 0);
        runner.onStateChange('solar.solar_mode', { val: 2, ack: false });
        await host.timers.advance(2000);
        expect(host.writes).to.deep.equal([]);
        expect(host.acknowledged).to.deep.equal([['solar.solar_mode', 0]]);
        expect(host.errors[0]).to.include('not connected');
    });

    it('controls the rooms of a zone module and warns once if the room is not in operating mode Normal', async () => {
        const { host, runner } = await make({ writeZones: true });
        expect(host.subscribed).to.include.members([
            'zones.1.rooms.1.setpoint',
            'zones.1.rooms.1.mode',
            'zones.10.rooms.8.setpoint',
        ]);
        expect(host.subscribed.some(id => id.endsWith('.temp') || id.endsWith('.humidity'))).to.equal(false);
        host.known.set('zm1_room1_mode', 1); // automatic
        runner.onStateChange('zones.1.rooms.1.setpoint', { val: 21.3, ack: false });
        await host.timers.advance(3000);
        expect(host.acknowledged).to.deep.equal([['zones.1.rooms.1.setpoint', 21.5]]);
        expect(host.writes[0]).to.deep.equal({ address: 2004, words: [0x0000, 0x41ac] });
        expect(host.logs.filter(l => l.startsWith('warn') && l.includes('Normal'))).to.have.length(1);
        // a second setpoint within the hour does not repeat the warning
        host.timers.time += 61000;
        runner.onStateChange('zones.1.rooms.1.setpoint', { val: 22, ack: false });
        await host.timers.advance(3000);
        expect(host.logs.filter(l => l.startsWith('warn') && l.includes('Normal'))).to.have.length(1);
        // in Normal mode there is nothing to warn about
        host.known.set('zm1_room2_mode', 3);
        runner.onStateChange('zones.1.rooms.2.setpoint', { val: 21, ack: false });
        await host.timers.advance(3000);
        expect(host.logs.filter(l => l.startsWith('warn') && l.includes('Normal'))).to.have.length(1);
    });

    it('acknowledges faults with a button that resets itself and is never read back', async () => {
        const { host, runner } = await make({ writeSystem: true });
        runner.onStateChange('system.error_acknowledge', { val: true, ack: false });
        await host.timers.advance(2000);
        expect(host.writes).to.deep.equal([{ address: 1999, words: [1] }]);
        expect(host.acknowledged).to.deep.equal([['system.error_acknowledge', false]]);
    });

    it('restores counters at start and ignores damaged ones', async () => {
        const host = new FakeHost();
        host.saved = JSON.stringify({ system_mode: { total: 7, day: 1, date: '2026-03-10' } });
        const control = readControlSettings({ writeSystem: true });
        const options = {
            registers: nav20,
            control,
            floatWordOrder: 'lowFirst' as const,
            dateKey: (ms: number): string => new Date(ms).toISOString().slice(0, 10),
        };
        await new ControlRunner(host, options).start();
        host.timers.time = Date.UTC(2026, 2, 10, 12, 0, 0);
        const damaged = new FakeHost();
        damaged.saved = '{broken';
        await new ControlRunner(damaged, options).start();
        expect(damaged.logs.some(l => l.startsWith('warn') && l.includes('write counters'))).to.equal(true);
    });
});
