import { expect } from 'chai';
import { ManualTimers } from '../manual-timers.test';
import { fail, ok, type Result } from '../modbus/result';
import { loadRegisters } from '../registers/plant';
import type { RegisterEntry } from '../registers/types';
import { LOCK_MS, type SchedulerOptions, WriteScheduler, type WriteExecutor, type WriteOutcome } from './scheduler';

const nav20 = loadRegisters('nav20') as RegisterEntry[];
const reg = (id: string): RegisterEntry => nav20.find(r => r.id === id) as RegisterEntry;
const SECOND = 1000;
const MINUTE = 60 * SECOND;

/** A Navigator in memory that only exists in this test. */
class FakeNavigator implements WriteExecutor {
    public online = true;
    public memory = new Map<string, number[]>();
    public reads: string[] = [];
    public writes: { id: string; words: number[] }[] = [];
    public failWrites = 0;
    public corruptReadback = false;
    public connected = (): boolean => this.online;
    public read = (r: RegisterEntry): Promise<Result<number[]>> => {
        this.reads.push(r.id);
        const stored = this.memory.get(r.id);
        if (!stored) {
            return Promise.resolve(ok(Array.from({ length: r.words }, () => 0)));
        }
        return Promise.resolve(ok(this.corruptReadback ? stored.map(w => w ^ 1) : stored));
    };
    public write = (r: RegisterEntry, words: number[]): Promise<Result<void>> => {
        if (this.failWrites > 0) {
            this.failWrites--;
            return Promise.resolve(fail('timeout', 'No response'));
        }
        this.writes.push({ id: r.id, words });
        this.memory.set(r.id, words);
        return Promise.resolve(ok(undefined));
    };
}

interface Setup {
    timers: ManualTimers;
    navigator: FakeNavigator;
    scheduler: WriteScheduler;
    logs: string[];
}

const setup = (overrides: Partial<SchedulerOptions> = {}, current: Record<string, number> = {}): Setup => {
    const timers = new ManualTimers();
    timers.time = Date.UTC(2026, 2, 10, 12, 0, 0);
    const navigator = new FakeNavigator();
    const logs: string[] = [];
    const scheduler = new WriteScheduler({
        executor: navigator,
        timers,
        now: timers.now,
        log: {
            debug: m => void logs.push(`debug ${m}`),
            info: m => void logs.push(`info ${m}`),
            warn: m => void logs.push(`warn ${m}`),
        },
        context: { current: id => current[id], floatWordOrder: 'lowFirst' },
        dateKey: ms => new Date(ms).toISOString().slice(0, 10),
        minEepromIntervalMs: 60 * SECOND,
        dailyWarnThreshold: 24,
        ...overrides,
    });
    return { timers, navigator, scheduler, logs };
};

/**
 * Collect the outcome of a request.
 *
 * @param promise the submit() promise
 */
function track(promise: Promise<WriteOutcome>): { outcome?: WriteOutcome } {
    const box: { outcome?: WriteOutcome } = {};
    void promise.then(o => (box.outcome = o));
    return box;
}

describe('WriteScheduler', () => {
    it('debounces, writes, reads back and confirms; EEPROM registers are counted and logged', async () => {
        const { timers, navigator, scheduler, logs } = setup();
        const result = track(scheduler.submit(reg('system_mode'), 2));
        await timers.advance(999);
        expect(navigator.writes).to.deep.equal([]); // still debouncing
        await timers.advance(1);
        expect(navigator.writes).to.deep.equal([{ id: 'system_mode', words: [2] }]);
        expect(result.outcome).to.equal(undefined); // not confirmed before the read-back
        await timers.advance(1000);
        expect(result.outcome).to.deep.equal({ kind: 'written', value: 2 });
        expect(scheduler.counters.system_mode).to.include({ total: 1, day: 1 });
        expect(logs.some(l => l.startsWith('info EEPROM register system_mode'))).to.equal(true);
    });

    it('refuses invalid values at once without touching the device', async () => {
        const { navigator, scheduler } = setup();
        expect(await scheduler.submit(reg('system_mode'), 3)).to.include({
            kind: 'refused',
            reason: 'not-allowed-value',
        });
        expect(await scheduler.submit(reg('outdoor_temp'), 3)).to.include({ kind: 'refused', reason: 'not-writable' });
        expect(navigator.reads).to.deep.equal([]);
        expect(navigator.writes).to.deep.equal([]);
    });

    it('writes only the last value of a burst; the earlier requests end as superseded', async () => {
        const { timers, navigator, scheduler } = setup();
        const first = track(scheduler.submit(reg('hc_a_mode'), 2));
        await timers.advance(300);
        const second = track(scheduler.submit(reg('hc_a_mode'), 3));
        await timers.advance(300);
        const third = track(scheduler.submit(reg('hc_a_mode'), 4));
        await timers.advance(3000);
        expect(first.outcome).to.deep.equal({ kind: 'superseded' });
        expect(second.outcome).to.deep.equal({ kind: 'superseded' });
        expect(third.outcome).to.deep.equal({ kind: 'written', value: 4 });
        expect(navigator.writes).to.deep.equal([{ id: 'hc_a_mode', words: [4] }]);
    });

    it('holds an EEPROM register back until 60 s have passed and then writes the newest value', async () => {
        const { timers, navigator, scheduler } = setup();
        scheduler.submit(reg('system_mode'), 2).catch(() => undefined);
        await timers.advance(2000);
        expect(navigator.writes).to.have.length(1);

        const early = track(scheduler.submit(reg('system_mode'), 4)); // 2 s after the first write
        await timers.advance(20 * SECOND);
        const newer = track(scheduler.submit(reg('system_mode'), 5));
        await timers.advance(30 * SECOND);
        expect(navigator.writes).to.have.length(1); // 52 s after the first write: still held back
        await timers.advance(10 * SECOND);
        await timers.advance(2000);
        expect(early.outcome).to.deep.equal({ kind: 'superseded' });
        expect(newer.outcome).to.deep.equal({ kind: 'written', value: 5 });
        expect(navigator.writes.map(w => w.words[0])).to.deep.equal([2, 5]);
    });

    it('does not write an EEPROM register that already has the value, but writes other registers without asking first', async () => {
        const { timers, navigator, scheduler } = setup();
        navigator.memory.set('system_mode', [1]);
        const same = track(scheduler.submit(reg('system_mode'), 1));
        await timers.advance(1500);
        expect(same.outcome).to.deep.equal({ kind: 'unchanged', value: 1 });
        expect(navigator.writes).to.deep.equal([]);
        expect(scheduler.counters).to.deep.equal({});

        // demand_heating is not an EEPROM register: no pre-read, always written
        scheduler.submit(reg('demand_heating'), 1).catch(() => undefined);
        await timers.advance(3000);
        expect(navigator.reads.filter(r => r === 'demand_heating')).to.have.length(1); // only the read-back
        expect(navigator.writes.map(w => w.id)).to.deep.equal(['demand_heating']);
    });

    it('treats room setpoints like EEPROM registers: rounded, skipped when equal, held back for the minimum interval', async () => {
        const { timers, navigator, scheduler } = setup();
        const first = track(scheduler.submit(reg('zm1_room2_setpoint'), 21.3)); // becomes 21.5
        await timers.advance(3000);
        expect(first.outcome).to.deep.equal({ kind: 'written', value: 21.5 });
        expect(navigator.writes[0].words).to.deep.equal([0x0000, 0x41ac]);
        const same = track(scheduler.submit(reg('zm1_room2_setpoint'), 21.4)); // also 21.5: nothing to write, but not before the interval
        await timers.advance(30 * SECOND);
        expect(same.outcome).to.equal(undefined);
        await timers.advance(40 * SECOND);
        expect(same.outcome).to.deep.equal({ kind: 'unchanged', value: 21.5 });
        const other = track(scheduler.submit(reg('zm1_room2_setpoint'), 22)); // a real change is written
        await timers.advance(70 * SECOND);
        expect(other.outcome).to.deep.equal({ kind: 'written', value: 22 });
        expect(navigator.writes).to.have.length(2);
    });

    it('writes a write-only register once and does not try to read it back', async () => {
        const { timers, navigator, scheduler } = setup();
        const result = track(scheduler.submit(reg('error_acknowledge'), true));
        await timers.advance(1500);
        expect(result.outcome).to.deep.equal({ kind: 'written', value: 1 });
        expect(navigator.writes).to.deep.equal([{ id: 'error_acknowledge', words: [1] }]);
        expect(navigator.reads).to.deep.equal([]);
    });

    it('writes FLOAT values as two words in the configured order and confirms them', async () => {
        const { timers, navigator, scheduler } = setup();
        const result = track(scheduler.submit(reg('hc_a_room_setpoint_heat_normal'), 21.5));
        await timers.advance(3000);
        expect(navigator.writes[0].words).to.deep.equal([0x0000, 0x41ac]);
        expect(result.outcome).to.deep.equal({ kind: 'written', value: 21.5 });
    });

    it('never queues a write while the connection is down', async () => {
        const { timers, navigator, scheduler } = setup();
        navigator.online = false;
        const result = track(scheduler.submit(reg('dhw_setpoint'), 48));
        await timers.advance(2000);
        expect(result.outcome).to.include({ kind: 'refused', reason: 'offline' });
        navigator.online = true;
        await timers.advance(5 * MINUTE);
        expect(navigator.writes).to.deep.equal([]); // nothing was kept for later
    });

    it('treats a differing read-back as a failure, locks after three failures in a row and unlocks after ten minutes', async () => {
        const { timers, navigator, scheduler, logs } = setup({ minEepromIntervalMs: 0 });
        navigator.corruptReadback = true;
        for (let i = 0; i < 3; i++) {
            const result = track(scheduler.submit(reg('hc_b_mode'), 2));
            await timers.advance(3000);
            expect(result.outcome).to.include({ kind: 'failed' });
        }
        expect(logs.some(l => l.startsWith('warn') && l.includes('locked'))).to.equal(true);
        expect(await scheduler.submit(reg('hc_b_mode'), 3)).to.include({ kind: 'refused', reason: 'locked' });
        navigator.corruptReadback = false;
        await timers.advance(LOCK_MS + SECOND);
        const after = track(scheduler.submit(reg('hc_b_mode'), 3));
        await timers.advance(3000);
        expect(after.outcome).to.deep.equal({ kind: 'written', value: 3 });
    });

    it('counts a failed write as a failure and resets the count after a success', async () => {
        const { timers, navigator, scheduler } = setup({ minEepromIntervalMs: 0 });
        navigator.failWrites = 2;
        for (let i = 0; i < 2; i++) {
            const failed = track(scheduler.submit(reg('hc_c_mode'), 2));
            await timers.advance(3000);
            expect(failed.outcome).to.include({ kind: 'failed' });
        }
        const good = track(scheduler.submit(reg('hc_c_mode'), 2));
        await timers.advance(3000);
        expect(good.outcome).to.deep.equal({ kind: 'written', value: 2 });
        navigator.failWrites = 2;
        for (let i = 0; i < 2; i++) {
            scheduler.submit(reg('hc_c_mode'), 3).catch(() => undefined);
            await timers.advance(3000);
        }
        // two failures after a success are not three in a row: not locked
        const next = track(scheduler.submit(reg('hc_c_mode'), 4));
        await timers.advance(3000);
        expect(next.outcome).to.deep.equal({ kind: 'written', value: 4 });
    });

    it('warns when one register is written again within five seconds', async () => {
        const { timers, scheduler, logs } = setup();
        scheduler.submit(reg('demand_cooling'), 1).catch(() => undefined);
        await timers.advance(2000);
        scheduler.submit(reg('demand_cooling'), 0).catch(() => undefined);
        await timers.advance(2000);
        expect(logs.filter(l => l.startsWith('warn') && l.includes('another automation'))).to.have.length(1);
    });

    it('warns once per day when a register passes the daily threshold', async () => {
        const { timers, scheduler, logs } = setup({ minEepromIntervalMs: 0, dailyWarnThreshold: 3 });
        for (let i = 0; i < 5; i++) {
            scheduler.submit(reg('dhw_setpoint'), 40 + i).catch(() => undefined);
            await timers.advance(10 * SECOND);
        }
        expect(logs.filter(l => l.startsWith('warn') && l.includes('times today'))).to.have.length(1);
        expect(scheduler.counters.dhw_setpoint).to.include({ total: 5, day: 5 });
    });

    it('keeps its counters across a restart and starts a new day count', async () => {
        const first = setup();
        first.scheduler.submit(reg('solar_mode'), 1).catch(() => undefined);
        await first.timers.advance(3000);
        const saved = JSON.parse(JSON.stringify(first.scheduler.counters));
        const second = setup();
        second.scheduler.restore(saved);
        expect(second.scheduler.counters.solar_mode).to.include({ total: 1, day: 1 });
        second.timers.time += 24 * 3600 * 1000;
        second.scheduler.submit(reg('solar_mode'), 2).catch(() => undefined);
        await second.timers.advance(3000);
        expect(second.scheduler.counters.solar_mode).to.include({ total: 2, day: 1 });
        second.scheduler.restore({ broken: { total: 'x' as never } });
    });

    it('applies the hot water order rule with the values the context knows', async () => {
        const { scheduler } = setup({}, { dhw_charge_on_temp: 49, dhw_charge_off_temp: 50 });
        expect(await scheduler.submit(reg('dhw_charge_off_temp'), 48)).to.include({ kind: 'refused', reason: 'order' });
    });

    it('cancels everything on shutdown', async () => {
        const { timers, navigator, scheduler } = setup();
        const result = track(scheduler.submit(reg('system_mode'), 2));
        scheduler.shutdown();
        await timers.advance(5000);
        expect(result.outcome).to.deep.equal({ kind: 'superseded' });
        expect(navigator.writes).to.deep.equal([]);
    });
});
