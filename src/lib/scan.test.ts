import { expect } from 'chai';
import { fail, ok, type Result } from './modbus/result';
import { loadRegisters } from './registers/plant';
import type { RegisterEntry } from './registers/types';
import { plantToNative, runScan, scanToCsv, summarizeScan, suggestPlant, type ScanOptions } from './scan';

const nav20 = loadRegisters('nav20') as RegisterEntry[];
const reg = (id: string): RegisterEntry => nav20.find(r => r.id === id) as RegisterEntry;

/** Fake device: per address either words or an exception; counts requests. */
class FakeDevice {
    public requests: string[] = [];
    public constructor(
        private readonly words: Map<number, number[]>,
        private readonly dropAt?: number,
    ) {}
    public readRegisters(fc: 3 | 4, address: number, count: number): Promise<Result<number[]>> {
        this.requests.push(`${fc}@${address}`);
        if (this.dropAt !== undefined && this.requests.length >= this.dropAt) {
            return Promise.resolve(fail('offline', 'Connection lost'));
        }
        const words = this.words.get(address);
        return Promise.resolve(
            words && words.length === count ? ok(words) : fail('exception', 'Modbus exception 2', 2),
        );
    }
}

const base = (device: FakeDevice, ids: string[]): ScanOptions => ({
    registers: ids.map(reg),
    client: device,
    floatWordOrder: 'lowFirst',
    now: () => 0,
    family: 'nav20',
    device: 'test device',
    adapterVersion: '0.0.0',
});

describe('runScan', () => {
    it('reads FC04 then FC03 per register, one by one, and classifies the answers', async () => {
        const device = new FakeDevice(
            new Map([
                [1000, [0x0000, 0x41ac]], // outdoor temperature 21.5
                [1104, [0xffff]], // charging pump: not available
            ]),
        );
        const scan = await runScan(base(device, ['outdoor_temp', 'charging_pump_status', 'hc_g_flow_temp']));
        expect(device.requests).to.deep.equal(['4@1000', '3@1000', '4@1104', '3@1104', '4@1362', '3@1362']);
        expect(scan.entries.map(e => [e.id, e.status, e.value])).to.deep.equal([
            ['outdoor_temp', 'present', 21.5],
            ['charging_pump_status', 'unavailable', null],
            ['hc_g_flow_temp', 'absent', null],
        ]);
        expect(scan.entries[2].reads['4']).to.include({ ok: false, exceptionCode: 2 });
        expect(summarizeScan(scan)).to.deep.equal({ present: 1, unavailable: 1, absent: 1, total: 3 });
    });

    it('skips write-only registers and reports progress', async () => {
        const device = new FakeDevice(new Map());
        const progress: number[] = [];
        const scan = await runScan({
            ...base(device, ['ext_outdoor_temp', 'outdoor_temp']),
            progress: done => progress.push(done),
        });
        expect(scan.entries.map(e => e.id)).to.deep.equal(['outdoor_temp']);
        expect(progress).to.deep.equal([1]);
    });

    it('ends early with a partial result when the connection is lost', async () => {
        const device = new FakeDevice(new Map([[1000, [0x0000, 0x41ac]]]), 3);
        const scan = await runScan(base(device, ['outdoor_temp', 'outdoor_temp_avg', 'storage_temp']));
        expect(scan.aborted).to.equal('offline');
        expect(scan.entries.map(e => e.id)).to.deep.equal(['outdoor_temp']);
    });

    it('stops when asked to (adapter unload)', async () => {
        const device = new FakeDevice(new Map());
        const scan = await runScan({ ...base(device, ['outdoor_temp', 'storage_temp']), shouldStop: () => true });
        expect(scan.aborted).to.equal('stopped');
        expect(device.requests).to.deep.equal([]);
    });
});

describe('suggestPlant', () => {
    it('derives circuits, zone modules, rooms and blocks from the answering registers', async () => {
        const words = new Map<number, number[]>();
        const temp = [0x0000, 0x41ac];
        for (const id of [
            'hc_a_flow_temp',
            'hc_b_flow_temp',
            'solar_collector_temp',
            'zm1_room3_temp',
            'zm2_room1_temp',
            'pv_surplus',
        ]) {
            words.set(reg(id).address, temp);
        }
        words.set(reg('zm1_mode_heat_cool').address, [1]);
        words.set(reg('zm2_mode_heat_cool').address, [1]);
        words.set(reg('bivalence_state').address, [0]);
        const scan = await runScan(
            base(
                new FakeDevice(words),
                nav20.filter(r => r.access !== 'W').map(r => r.id),
            ),
        );
        const plant = suggestPlant(scan);
        expect(plant.heatingCircuits).to.deep.equal(['A', 'B']);
        expect(plant.zoneModules).to.equal(2);
        expect(plant.roomsPerZone).to.equal(3);
        expect(plant.blocks).to.deep.equal({
            solar: true,
            isc: false,
            cascade: false,
            bivalence: true,
            pv: true,
            booster: false,
        });
    });
});

describe('plantToNative', () => {
    it('turns a suggested layout into the checkboxes and numbers of the Installation tab', () => {
        const native = plantToNative({
            heatingCircuits: ['A', 'C'],
            zoneModules: 2,
            roomsPerZone: 6,
            blocks: { solar: false, isc: true, cascade: false, bivalence: true, pv: true, booster: false },
        });
        expect(native).to.deep.include({
            zoneModules: 2,
            roomsPerZone: 6,
            blockSolar: false,
            blockIsc: true,
            blockBivalence: true,
            blockPv: true,
            blockBooster: false,
            hcA: true,
            hcB: false,
            hcC: true,
            hcG: false,
        });
        expect(Object.keys(native)).to.have.length(8 + 7);
    });
});

describe('scanToCsv', () => {
    it('lists address, status, raw words and exception codes', async () => {
        const scan = await runScan(
            base(new FakeDevice(new Map([[1000, [0x0000, 0x41ac]]])), ['outdoor_temp', 'storage_temp']),
        );
        const lines = scanToCsv(scan).trim().split('\n');
        expect(lines[0]).to.equal('address,id,type,status,value,fc4,fc4_raw,fc4_ms,fc3,fc3_raw,fc3_ms');
        expect(lines[1]).to.equal('1000,outdoor_temp,FLOAT,present,21.5,ok,0 16812,0,ok,0 16812,0');
        expect(lines[2]).to.equal('1008,storage_temp,FLOAT,absent,,exception 2,,0,exception 2,,0');
    });
});
