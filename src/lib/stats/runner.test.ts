import { expect } from 'chai';
import type { StatsSettings } from '../config';
import type { PlannedObject } from '../object-tree';
import { type Sample, StatsRunner, type StatsHost } from './runner';

const HOUR = 3600000;
const T0 = new Date(2026, 2, 10, 12, 0, 0).getTime();
const INTERVALS = { fast: 30000, medium: 60000, slow: 300000, config: 3600000 };

const settings = (overrides: Partial<StatsSettings> = {}): StatsSettings => ({
    enabled: true,
    electricalCounter: null,
    electricalPower: null,
    heatCounter: null,
    heatPower: null,
    thermalSource: 'navigator',
    pricePerKwh: 0.3,
    priceStateId: null,
    co2StateId: null,
    currency: 'EUR',
    co2GramsPerKwh: 350,
    priceStateFactor: 1,
    co2StateFactor: 1,
    externalMaxAgeMs: 120000,
    warnings: [],
    ...overrides,
});

/** Fake adapter: manual clock and timers, recorded states. */
class FakeHost implements StatsHost {
    public time = T0;
    public samples = new Map<string, Sample>();
    public objects: PlannedObject[] = [];
    public published = new Map<string, number | null>();
    public publishCount = 0;
    public saved: string | null = null;
    public units = new Map<string, string>();
    public foreign = new Map<string, { val: unknown; ts: number }>();
    public subscribed: string[] = [];
    public logs: string[] = [];
    public intervals: { cb: () => void; ms: number; id: number }[] = [];
    private nextId = 1;
    public log = {
        debug: (m: string): void => void this.logs.push(`debug ${m}`),
        info: (m: string): void => void this.logs.push(`info ${m}`),
        warn: (m: string): void => void this.logs.push(`warn ${m}`),
    };
    public timers = {
        setInterval: (cb: () => void, ms: number): unknown => {
            const id = this.nextId++;
            this.intervals.push({ cb, ms, id });
            return id;
        },
        clearInterval: (handle: unknown): void => {
            this.intervals = this.intervals.filter(i => i.id !== handle);
        },
    };
    public now = (): number => this.time;
    public sample = (id: string): Sample | undefined => this.samples.get(id);
    public createObjects = (objects: PlannedObject[]): Promise<void> => {
        this.objects = objects;
        return Promise.resolve();
    };
    public publish = (id: string, value: number | null): void => {
        this.published.set(id, value);
        this.publishCount++;
    };
    public loadData = (): Promise<string | null> => Promise.resolve(this.saved);
    public saveData = (json: string): void => {
        this.saved = json;
    };
    public foreignUnit = (id: string): Promise<string | undefined> => Promise.resolve(this.units.get(id));
    public subscribe = (id: string): void => void this.subscribed.push(id);
    public foreignState = (id: string): Promise<{ val: unknown; ts: number } | null> =>
        Promise.resolve(this.foreign.get(id) ?? null);

    /**
     * Set a fresh Navigator reading.
     *
     * @param id register id
     * @param value decoded value
     * @param poll polling group of the register
     */
    public set(id: string, value: number | null, poll: Sample['poll'] = 'fast'): void {
        this.samples.set(id, { value, at: this.time, poll });
    }
    /**
     * Advance the clock and run the calculation tick.
     *
     * @param ms milliseconds to advance
     */
    public advance(ms: number): void {
        this.time += ms;
        this.intervals.find(i => i.ms === 30000)?.cb();
    }
}

const start = async (host: FakeHost, overrides: Partial<StatsSettings> = {}): Promise<StatsRunner> => {
    const runner = new StatsRunner(host, {
        settings: settings(overrides),
        circuits: ['A'],
        intervalsMs: INTERVALS,
        tickMs: 30000,
    });
    await runner.start();
    return runner;
};

/**
 * Navigator values of a running heating pump.
 *
 * @param host the fake adapter
 * @param electricalKw electrical power in kW
 */
const running = (host: FakeHost, electricalKw = 2): void => {
    host.set('hp_operating_mode', 1);
    host.set('power_consumption_hp', electricalKw);
    host.set('thermal_power_flow_sensor', 9);
    host.set('compressor_status_1', 1);
    host.set('hp_flow_temp', 35);
    host.set('hp_return_temp', 30);
};

describe('StatsRunner', () => {
    it('creates the objects and the timers at start, and saves on stop', async () => {
        const host = new FakeHost();
        const runner = await start(host);
        const ids = host.objects.map(o => o.id);
        expect(ids).to.include.members([
            'calc',
            'calc.hp_delta_t',
            'stats',
            'stats.energy.thermal.heating.day',
            'stats.cop.internal.all.rolling365',
        ]);
        expect(host.intervals.map(i => i.ms)).to.deep.equal([30000, 60000]);
        runner.stop();
        expect(host.intervals).to.have.length(0);
        expect(JSON.parse(host.saved as string)).to.have.property('version', 1);
    });

    it('calculates from the Navigator readings and publishes only what changed', async () => {
        const host = new FakeHost();
        await start(host);
        running(host);
        host.advance(0);
        for (let i = 0; i < 120; i++) {
            running(host);
            host.set('energy_heating', 1000 + (9 * i) / 120, 'slow');
            host.advance(30000);
        }
        expect(host.published.get('stats.energy.electrical.internal.all.day')).to.be.closeTo(2, 0.01);
        expect(host.published.get('stats.energy.thermal.heating.day')).to.be.closeTo(9, 0.1);
        expect(host.published.get('calc.hp_delta_t')).to.equal(5);
        expect(host.published.get('stats.runtime.compressor1.hours_day')).to.be.closeTo(1, 0.05);
        const before = host.publishCount;
        running(host);
        host.advance(30000); // only values that really change are written, not all of them
        expect(host.publishCount - before).to.be.lessThan(host.published.size / 2);
    });

    it('ignores readings that are too old (no integration of a power value from before a connection loss)', async () => {
        const host = new FakeHost();
        await start(host);
        running(host);
        host.advance(30000);
        host.advance(30000);
        // the Navigator readings stop; the clock runs on
        host.time += 10 * 60000;
        host.advance(30000);
        host.advance(30000);
        expect(host.published.get('stats.energy.electrical.internal.all.day')).to.be.lessThan(0.05);
        expect(host.published.get('calc.cop_internal')).to.equal(null);
    });

    it('feeds the external meter, converting W to kW and Wh to kWh from the declared or the detected unit', async () => {
        const host = new FakeHost();
        host.units.set('meter.power', 'W');
        host.foreign.set('meter.counter', { val: '5000', ts: T0 }); // string values from the state are accepted
        host.foreign.set('meter.power', { val: 2000, ts: T0 });
        const runner = await start(host, {
            electricalCounter: { id: 'meter.counter', unit: 'Wh' },
            electricalPower: { id: 'meter.power', unit: 'auto' },
        });
        expect(host.subscribed).to.have.members(['meter.counter', 'meter.power']);
        host.time += HOUR;
        runner.onForeignState('meter.counter', { val: 7500, ts: host.time }); // +2500 Wh = 2.5 kWh
        runner.onForeignState('meter.power', { val: 2500, ts: host.time });
        host.advance(0);
        expect(host.published.get('stats.energy.electrical.external.all.day')).to.equal(2.5);
        expect(host.published.get('stats.cost.day')).to.equal(0.75); // 2.5 kWh * 0.30
        expect(host.published.get('calc.cop_external')).to.equal(null); // no thermal power from the Navigator
        host.set('thermal_power_flow_sensor', 10);
        host.advance(0);
        expect(host.published.get('calc.cop_external')).to.equal(4);
    });

    it('switches a source off, with a warning, when its unit is neither declared nor detectable', async () => {
        const host = new FakeHost();
        host.foreign.set('meter.counter', { val: 5000, ts: T0 });
        const runner = await start(host, {
            electricalPower: { id: 'meter.power', unit: 'auto' },
            electricalCounter: { id: 'meter.counter', unit: 'auto' },
        });
        expect(host.logs.filter(l => l.startsWith('warn') && l.includes('switched off'))).to.have.length(2);
        expect(host.subscribed).to.deep.equal([]); // neither source is used
        host.time += HOUR;
        runner.onForeignState('meter.counter', { val: 5500, ts: host.time }); // would be 500 kWh if it were guessed
        host.advance(0);
        expect(host.published.get('stats.energy.electrical.external.all.day')).to.equal(0);
    });

    it('reads the price from a state and keeps working without it', async () => {
        const host = new FakeHost();
        host.foreign.set('tariff.price', { val: 0.5, ts: T0 });
        const runner = await start(host, { pricePerKwh: null, priceStateId: 'tariff.price' });
        running(host);
        host.advance(0);
        for (let i = 0; i < 120; i++) {
            host.set('hp_operating_mode', 1);
            host.set('power_consumption_hp', 2);
            host.advance(30000);
        }
        expect(host.published.get('stats.cost.day')).to.be.closeTo(1, 0.02); // 2 kWh * 0.50
        runner.onForeignState('tariff.price', { val: 'n/a', ts: host.time }); // unusable value: no price, no new cost
        const before = host.published.get('stats.cost.day') as number;
        host.set('power_consumption_hp', 2);
        host.advance(30000);
        host.set('power_consumption_hp', 2);
        host.advance(30000);
        expect(host.published.get('stats.cost.day')).to.equal(before);
    });

    it('takes the CO2 intensity from a state', async () => {
        const host = new FakeHost();
        host.foreign.set('grid.co2', { val: '120', ts: T0 });
        const runner = await start(host, { co2StateId: 'grid.co2' });
        expect(host.subscribed).to.include('grid.co2');
        host.advance(0);
        expect(host.published.get('stats.co2.intensity')).to.equal(120);
        runner.onForeignState('grid.co2', { val: 'n/a', ts: host.time }); // unusable: the fixed factor again
        host.advance(30000);
        expect(host.published.get('stats.co2.intensity')).to.equal(350);
    });

    it('converts a CO2 state in kg/kWh and a price state in cent/kWh', async () => {
        const host = new FakeHost();
        host.foreign.set('grid.co2', { val: 0.12, ts: T0 });
        host.foreign.set('tariff.price', { val: 50, ts: T0 });
        await start(host, {
            co2StateId: 'grid.co2',
            co2StateFactor: 1000,
            pricePerKwh: null,
            priceStateId: 'tariff.price',
            priceStateFactor: 0.01,
        });
        host.advance(0);
        expect(host.published.get('stats.co2.intensity')).to.equal(120);
    });

    it('persists and restores, ignores damaged data, and can be reset', async () => {
        const first = new FakeHost();
        const runner = await start(first);
        running(first);
        first.advance(0);
        for (let i = 0; i < 60; i++) {
            first.set('hp_operating_mode', 1);
            first.set('power_consumption_hp', 2);
            first.advance(30000);
        }
        runner.stop();

        const second = new FakeHost();
        second.time = first.time;
        second.saved = first.saved;
        await start(second);
        second.advance(0);
        expect(second.published.get('stats.energy.electrical.internal.all.total')).to.be.closeTo(1, 0.02);

        const damaged = new FakeHost();
        damaged.saved = '{not json';
        await start(damaged);
        expect(damaged.logs.some(l => l.startsWith('warn') && l.includes('start from zero'))).to.equal(true);

        const resettable = new FakeHost();
        resettable.saved = first.saved;
        const resetRunner = await start(resettable);
        resetRunner.reset();
        expect(resettable.published.get('stats.energy.electrical.internal.all.total')).to.equal(0);
        expect(JSON.parse(resettable.saved as string).ledger.totals.elecInternal.heating).to.equal(0);
    });

    it('warns once about a counter that jumps (wrong unit)', async () => {
        const host = new FakeHost();
        host.foreign.set('meter.counter', { val: 5000, ts: T0 });
        const runner = await start(host, { electricalCounter: { id: 'meter.counter', unit: 'kWh' } });
        host.time += 60000;
        runner.onForeignState('meter.counter', { val: 5500, ts: host.time }); // 500 kWh in a minute
        host.advance(0);
        host.time += 60000;
        runner.onForeignState('meter.counter', { val: 9500, ts: host.time });
        host.advance(0);
        expect(host.logs.filter(l => l.includes('Counter discontinuity'))).to.have.length(1);
    });
});
