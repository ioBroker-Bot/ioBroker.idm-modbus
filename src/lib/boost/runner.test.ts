import { expect } from 'chai';
import { fail, ok, type Result } from '../modbus/result';
import { BoostRunner, type BoostHost, type BoostOptions } from './runner';

class Fake implements BoostHost {
    public time = 1_000_000;
    public online = true;
    public temp: number | null = 40;
    public demand: boolean[] = [];
    public saved: string | null = null;
    public failNext = 0;
    public logs: string[] = [];
    public published: Record<string, boolean | number | string> = {};
    public intervals = 0;
    public log = {
        debug: (m: string): void => void this.logs.push(`debug ${m}`),
        info: (m: string): void => void this.logs.push(`info ${m}`),
        warn: (m: string): void => void this.logs.push(`warn ${m}`),
    };
    public timers = {
        setInterval: (): unknown => {
            this.intervals++;
            return this.intervals;
        },
        clearInterval: (): void => {
            this.intervals--;
        },
    };
    public now = (): number => this.time;
    public connected = (): boolean => this.online;
    public temperature = (): number | null => this.temp;
    public setDemand = (on: boolean): Promise<Result<void>> => {
        this.demand.push(on);
        if (this.failNext > 0) {
            this.failNext--;
            return Promise.resolve(fail('timeout', 'No response'));
        }
        return Promise.resolve(ok(undefined));
    };
    public publish = (id: string, value: boolean | number | string): void => {
        this.published[id] = value;
    };
    public load = (): Promise<string | null> => Promise.resolve(this.saved);
    public save = (json: string): void => {
        this.saved = json;
    };
}

const options: BoostOptions = { targetC: 55, maxMinutes: 60 };
const make = async (host: Fake, saved: string | null = null): Promise<BoostRunner> => {
    host.saved = saved;
    const runner = new BoostRunner(host, options);
    await runner.start();
    return runner;
};

describe('BoostRunner', () => {
    it('switches the demand on, refreshes it every cycle and ends it when the target is reached', async () => {
        const host = new Fake();
        const runner = await make(host);
        await runner.begin();
        expect(host.demand).to.deep.equal([true]);
        expect(host.published).to.deep.include({ active: true, status: 'running', remaining: 60 });
        host.time += 30000;
        host.temp = 50;
        await runner.tick();
        expect(host.demand).to.deep.equal([true, true]);
        host.temp = 55;
        await runner.tick();
        expect(host.demand).to.deep.equal([true, true, false]);
        expect(host.published).to.deep.include({ active: false, status: 'target_reached', remaining: 0 });
        expect(host.intervals).to.equal(0);
        expect(JSON.parse(host.saved as string)).to.deep.equal({ active: false });
    });

    it('ends at the time limit even if the temperature is unknown', async () => {
        const host = new Fake();
        const runner = await make(host);
        await runner.begin();
        host.temp = null;
        host.time += 59 * 60000;
        await runner.tick();
        expect(host.published.status).to.equal('running');
        expect(host.published.remaining).to.equal(1);
        host.time += 2 * 60000;
        await runner.tick();
        expect(host.demand.at(-1)).to.equal(false);
        expect(host.published.status).to.equal('timeout');
    });

    it('can be cancelled and shuts down by switching the demand off', async () => {
        const host = new Fake();
        const runner = await make(host);
        await runner.begin();
        await runner.cancel();
        expect(host.demand).to.deep.equal([true, false]);
        expect(host.published.status).to.equal('stopped');
        await runner.begin();
        await runner.shutdown();
        expect(host.demand).to.deep.equal([true, false, true, false]);
        expect(runner.running).to.equal(false);
    });

    it('refuses to start when offline, without temperature or when the water is already hot, and writes nothing', async () => {
        const host = new Fake();
        const runner = await make(host);
        host.online = false;
        await runner.begin();
        expect(host.published.status).to.equal('refused_offline');
        host.online = true;
        host.temp = null;
        await runner.begin();
        expect(host.published.status).to.equal('refused_no_temperature');
        host.temp = 56;
        await runner.begin();
        expect(host.published.status).to.equal('refused_at_target');
        expect(host.demand).to.deep.equal([]);
    });

    it('ends the boost after three failed refreshes and tries twice to switch the demand off', async () => {
        const host = new Fake();
        const runner = await make(host);
        await runner.begin();
        host.failNext = 3;
        for (let i = 0; i < 3; i++) {
            await runner.tick();
        }
        expect(host.published.status).to.equal('error');
        expect(host.demand.slice(-1)).to.deep.equal([false]);
        // the demand could not be switched off at all: flagged, kept as active in the persisted data
        const stubborn = new Fake();
        const second = await make(stubborn);
        await second.begin();
        stubborn.failNext = 2;
        await second.cancel();
        expect(stubborn.published.status).to.equal('error');
        expect(JSON.parse(stubborn.saved as string)).to.deep.equal({ active: true });
    });

    it('ends a boost that was running before a restart', async () => {
        const host = new Fake();
        await make(host, JSON.stringify({ active: true, deadline: 5 }));
        expect(host.demand).to.deep.equal([false]);
        expect(host.published.status).to.equal('stopped_after_restart');
        expect(host.logs.some(l => l.startsWith('warn') && l.includes('restart'))).to.equal(true);
        const clean = new Fake();
        await make(clean, JSON.stringify({ active: false }));
        expect(clean.demand).to.deep.equal([]);
        const damaged = new Fake();
        await make(damaged, '{not json');
        expect(damaged.demand).to.deep.equal([]);
    });

    it('starts only once while a boost is running', async () => {
        const host = new Fake();
        const runner = await make(host);
        await runner.begin();
        await runner.begin();
        expect(host.demand).to.deep.equal([true]);
    });
});
