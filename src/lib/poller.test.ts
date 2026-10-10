import { expect } from 'chai';
import type { ModbusError, Result } from './modbus/result';
import { fail, ok } from './modbus/result';
import { Poller, type PollSink, type RegisterReader } from './poller';
import { ManualTimers } from './manual-timers.test';
import { loadRegisters } from './registers/plant';
import type { RegisterEntry } from './registers/types';

const nav20 = loadRegisters('nav20') as RegisterEntry[];
const reg = (id: string): RegisterEntry => nav20.find(r => r.id === id) as RegisterEntry;

/** Fake client: serves values from a map of address -> words, with scripted failures. */
class FakeClient implements RegisterReader {
    public words = new Map<number, number>();
    public connectResults: Result<void>[] = [];
    public exceptionAddresses = new Set<number>();
    public requests: string[] = [];
    public closed = false;
    public onDisconnect: (reason: ModbusError) => void = () => undefined;

    public connect(): Promise<Result<void>> {
        return Promise.resolve(this.connectResults.shift() ?? ok(undefined));
    }
    public readRegisters(fc: 3 | 4, address: number, count: number): Promise<Result<number[]>> {
        this.requests.push(`${fc}@${address}x${count}`);
        for (let a = address; a < address + count; a++) {
            if (this.exceptionAddresses.has(a)) {
                return Promise.resolve(fail('exception', 'Modbus exception 2', 2));
            }
        }
        return Promise.resolve(ok(Array.from({ length: count }, (_, i) => this.words.get(address + i) ?? 0)));
    }
    public close(): void {
        this.closed = true;
    }
    public writeMultipleRegisters(address: number, words: readonly number[]): Promise<Result<void>> {
        this.requests.push(`w@${address}x${words.length}`);
        return Promise.resolve(ok(undefined));
    }
}

/** Records what the poller reports. */
class RecordingSink implements PollSink {
    public writes: { id: string; value: number | null; valid: boolean }[] = [];
    public connections: boolean[] = [];
    public invalids: string[] = [];
    public absents: string[] = [];
    public errors: string[] = [];
    public successes = 0;
    public logs: string[] = [];
    public log = {
        debug: (m: string): void => void this.logs.push(`debug ${m}`),
        info: (m: string): void => void this.logs.push(`info ${m}`),
        warn: (m: string): void => void this.logs.push(`warn ${m}`),
    };
    public write(r: RegisterEntry, value: number | null, valid: boolean): void {
        this.writes.push({ id: r.id, value, valid });
    }
    public connection(connected: boolean): void {
        this.connections.push(connected);
    }
    public invalid(r: RegisterEntry): void {
        this.invalids.push(r.id);
    }
    public absent(r: RegisterEntry): void {
        this.absents.push(r.id);
    }
    public error(message: string): void {
        this.errors.push(message);
    }
    public success(): void {
        this.successes++;
    }
}

/** 21.5 as two words, low word first. */
const FLOAT_21_5 = [0x0000, 0x41ac];

describe('Poller', () => {
    let timers: ManualTimers;
    let client: FakeClient;
    let sink: RecordingSink;

    const makePoller = (ids: string[], keepAlive = false): Poller => {
        const poller = new Poller({
            registers: ids.map(reg),
            floatWordOrder: 'lowFirst',
            intervalsMs: { fast: 30000, medium: 60000, slow: 300000, config: 3600000 },
            createClient: onDisconnect => {
                client.onDisconnect = onDisconnect;
                return client;
            },
            timers,
            now: timers.now,
            sink,
            ...(keepAlive ? { keepAlive: { fc: 4 as const, address: 1000, count: 2 } } : {}),
        });
        return poller;
    };

    beforeEach(() => {
        timers = new ManualTimers();
        client = new FakeClient();
        sink = new RecordingSink();
        client.words.set(1000, FLOAT_21_5[0]);
        client.words.set(1001, FLOAT_21_5[1]);
    });

    it('connects, reads the due groups immediately and then every interval', async () => {
        const poller = makePoller(['outdoor_temp', 'storage_temp']); // fast + medium
        poller.start();
        await timers.advance(0);
        expect(sink.connections).to.deep.equal([true]);
        expect(client.requests).to.deep.equal(['4@1000x2', '4@1008x2']);
        expect(sink.writes[0]).to.deep.equal({ id: 'outdoor_temp', value: 21.5, valid: true });
        await timers.advance(30000);
        expect(client.requests.filter(r => r.startsWith('4@1000'))).to.have.length(2);
        expect(client.requests.filter(r => r.startsWith('4@1008'))).to.have.length(1); // medium: every 60 s
        poller.stop();
    });

    it('writes only on change, and refreshes after 10 unchanged cycles', async () => {
        const poller = makePoller(['outdoor_temp']);
        poller.start();
        await timers.advance(0);
        await timers.advance(30000 * 5);
        expect(sink.writes).to.have.length(1);
        // deadband: a 0.005 change is ignored, a real change is written
        client.words.set(1000, 0x0000);
        client.words.set(1001, 0x41ac);
        await timers.advance(30000);
        expect(sink.writes).to.have.length(1);
        client.words.set(1001, 0x41b0); // 22.0
        await timers.advance(30000);
        expect(sink.writes.map(w => w.value)).to.deep.equal([21.5, 22]);
        await timers.advance(30000 * 10);
        expect(sink.writes.length).to.be.greaterThan(2); // periodic refresh
        poller.stop();
    });

    it('bundles adjacent registers into one request', async () => {
        const poller = makePoller(['hp_flow_temp', 'hp_return_temp', 'hgl_flow_temp']);
        poller.start();
        await timers.advance(0);
        expect(client.requests).to.deep.equal(['4@1050x6']);
        expect(sink.writes).to.have.length(3);
        poller.stop();
    });

    it('treats sentinels and out-of-range values as invalid (null) and counts them', async () => {
        client.words.set(1104, 0xffff); // charging pump -1 = not available
        client.words.set(1090, 7); // hp_operating_mode max is 8, 7 is in range
        client.words.set(1099, 9); // summary alarm max 1 -> invalid
        const poller = makePoller(['charging_pump_status', 'hp_sum_alarm']);
        poller.start();
        await timers.advance(0);
        expect(sink.writes).to.deep.include({ id: 'charging_pump_status', value: null, valid: false });
        expect(sink.writes).to.deep.include({ id: 'hp_sum_alarm', value: null, valid: false });
        expect(sink.invalids).to.have.members(['charging_pump_status', 'hp_sum_alarm']);
        poller.stop();
    });

    it('re-reads a failing block register by register and marks a missing register absent after 3 failures', async () => {
        client.exceptionAddresses.add(1054); // hgl_flow_temp
        const poller = makePoller(['hp_flow_temp', 'hp_return_temp', 'hgl_flow_temp']);
        poller.start();
        await timers.advance(0);
        expect(client.requests).to.deep.equal(['4@1050x6', '4@1050x2', '4@1052x2', '4@1054x2']);
        expect(sink.writes.map(w => w.id)).to.have.members(['hp_flow_temp', 'hp_return_temp']);
        await timers.advance(30000 * 2);
        expect(sink.absents).to.deep.equal(['hgl_flow_temp']);
        expect(poller.absentRegisterIds).to.deep.equal(['hgl_flow_temp']);
        client.requests.length = 0;
        await timers.advance(30000);
        expect(client.requests).to.deep.equal(['4@1050x4']); // the absent one is gone from the block
        poller.stop();
    });

    it('retries a failed connect with 5 s, 10 s, 20 s backoff and reports only the first failure as a warning', async () => {
        client.connectResults = [
            fail('connect', 'Connection failed'),
            fail('connect', 'Connection failed'),
            fail('connect', 'Connection failed'),
        ];
        const poller = makePoller(['outdoor_temp']);
        poller.start();
        await timers.advance(0);
        expect(sink.connections).to.deep.equal([]);
        await timers.advance(4999);
        expect(sink.connections).to.deep.equal([]);
        await timers.advance(1); // 5 s: second attempt fails, next in 10 s
        await timers.advance(10000); // third fails, next in 20 s
        await timers.advance(19999);
        expect(sink.connections).to.deep.equal([]);
        await timers.advance(1);
        expect(sink.connections).to.deep.equal([true]);
        expect(sink.logs.filter(l => l.startsWith('warn'))).to.have.length(1);
        poller.stop();
    });

    it('goes offline when the connection drops, reconnects and resumes polling', async () => {
        const poller = makePoller(['outdoor_temp']);
        poller.start();
        await timers.advance(0);
        expect(client.requests).to.have.length(1);
        client.onDisconnect(fail('offline', 'Connection lost').error);
        await timers.advance(0);
        expect(sink.connections).to.deep.equal([true, false]);
        await timers.advance(4999);
        expect(client.requests).to.have.length(1); // no polling while offline, first reconnect after 5 s
        await timers.advance(1);
        expect(sink.connections).to.deep.equal([true, false, true]);
        expect(client.requests).to.have.length(2);
        poller.stop();
    });

    it('stop() closes the client, cancels timers and reports offline', async () => {
        const poller = makePoller(['outdoor_temp']);
        poller.start();
        await timers.advance(0);
        poller.stop();
        expect(client.closed).to.equal(true);
        expect(sink.connections).to.deep.equal([true, false]);
        client.requests.length = 0;
        await timers.advance(600000);
        expect(client.requests).to.deep.equal([]);
    });

    it('sends a keepalive read when the connection was idle for 5 s, so the Navigator does not close it', async () => {
        const poller = makePoller(['storage_temp'], true); // medium group: next cycle only after 60 s
        poller.start();
        await timers.advance(0);
        expect(client.requests).to.deep.equal(['4@1008x2']);
        await timers.advance(4000);
        expect(client.requests).to.have.length(1); // not idle long enough yet
        await timers.advance(2000);
        expect(client.requests).to.deep.equal(['4@1008x2', '4@1000x2']); // keepalive after ~5 s
        await timers.advance(5000);
        expect(client.requests.filter(r => r === '4@1000x2')).to.have.length(2);
        poller.stop();
        client.requests.length = 0;
        await timers.advance(60000);
        expect(client.requests).to.deep.equal([]); // stopped: no keepalive either
    });

    it('does not send a keepalive before the connection has been idle for 5 s', async () => {
        const poller = makePoller(['outdoor_temp'], true); // fast group, every 30 s
        poller.start();
        await timers.advance(0);
        await timers.advance(4000);
        expect(client.requests).to.have.length(1);
        poller.stop();
    });

    it('reports request statistics', async () => {
        const poller = makePoller(['outdoor_temp']);
        poller.start();
        await timers.advance(0);
        expect(poller.takeStats().requests).to.equal(1);
        expect(poller.takeStats().requests).to.equal(0);
        poller.stop();
    });
});
