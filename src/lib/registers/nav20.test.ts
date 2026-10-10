import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    applyDeviceScan,
    compareWithPdfIndex,
    expandRegisters,
    type PdfIndex,
    type RegisterEntry,
    type SourceFile,
} from '../../../tools/build-registers';
import type { ScanResult } from '../scan';

const root = path.join(__dirname, '..', '..', '..');
const source = JSON.parse(fs.readFileSync(path.join(root, 'tools/sources/nav20.source.json'), 'utf8')) as SourceFile;
const pdfIndex = JSON.parse(fs.readFileSync(path.join(root, 'tools/sources/nav20.pdf-index.json'), 'utf8')) as PdfIndex;
const generated = JSON.parse(fs.readFileSync(path.join(__dirname, 'nav20.json'), 'utf8')) as {
    registers: RegisterEntry[];
};

const fixturePath = path.join(root, 'test', 'fixtures', 'scan-nav20.json');

describe('nav20 register file', () => {
    const registers = expandRegisters(source);
    if (fs.existsSync(fixturePath)) {
        applyDeviceScan(registers, JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as ScanResult);
    }
    const byId = new Map(registers.map(r => [r.id, r]));

    it('is up to date with the source file (run npm run build:registers)', () => {
        expect(generated.registers).to.deep.equal(registers);
    });

    it('contains every PDF address with matching type, access and EEPROM flag', () => {
        expect(compareWithPdfIndex(registers, pdfIndex)).to.deep.equal([]);
        expect(registers).to.have.length(pdfIndex.rows.length);
    });

    it('has unique ids and addresses', () => {
        expect(new Set(registers.map(r => r.id)).size).to.equal(registers.length);
        expect(new Set(registers.map(r => r.address)).size).to.equal(registers.length);
    });

    it('matches the spec check values of the address formulas', () => {
        expect(byId.get('zm1_room3_temp')?.address).to.equal(2016);
        expect(byId.get('zm2_room1_temp')?.address).to.equal(2067);
        expect(byId.get('zm1_room8_relay')?.address).to.equal(2057);
        expect(byId.get('zm10_room9_relay')?.address).to.equal(2649);
        expect(byId.get('hc_g_ext_room_temp')?.address).to.equal(1662);
        expect(byId.get('hc_g_mode')?.address).to.equal(1399);
        expect(byId.get('hc_c_flow_temp')?.address).to.equal(1354);
        expect(byId.get('hc_g_cooling_limit')?.address).to.equal(1490);
    });

    it('flags the overlaps of the document and the one found at the device (room humidity and mode)', () => {
        const pairs = registers
            .filter(r => r.overlaps.length)
            .map(r => r.address)
            .sort((x, y) => x - y);
        const documented = [1392, 1393, 1441, 1442, 1483, 1484];
        // found at the device: in a block read the room humidity is a FLOAT over 2006-2007 and clobbers the mode at 2007
        const device: number[] = [];
        for (let z = 0; z < 10; z++) {
            for (let r = 0; r < 8; r++) {
                device.push(2006 + 65 * z + 7 * r, 2007 + 65 * z + 7 * r);
            }
        }
        expect(pairs).to.deep.equal([...documented, ...device].sort((x, y) => x - y));
        expect(byId.get('humidity_sensor')?.overlaps).to.deep.equal(['hc_a_mode']);
        expect(byId.get('zm1_room3_mode')?.overlaps).to.deep.equal(['zm1_room3_humidity']);
    });

    it('marks EEPROM registers and cyclic write intervals', () => {
        expect(byId.get('system_mode')?.eeprom).to.equal(true);
        expect(byId.get('hc_a_mode')?.eeprom).to.equal(true);
        expect(byId.get('demand_heating')?.eeprom).to.equal(false);
        expect(byId.get('glt_temp_demand_heating')?.cyclicSec).to.equal(600);
        expect(byId.get('glt_temp_demand_cooling')?.cyclicSec).to.equal(600);
    });

    it('gives FLOAT two words, derives INT16 from the unsigned-less PDF WORD', () => {
        expect(byId.get('outdoor_temp')?.words).to.equal(2);
        expect(byId.get('brine_pump_status')?.type).to.equal('INT16');
        expect(byId.get('brine_pump_status')?.typeSource).to.equal('community');
        expect(byId.get('internal_message')?.type).to.equal('UINT16');
    });
});

describe('applyDeviceScan', () => {
    it('marks registers that answered with a plausible value as verified at the device', () => {
        const registers = expandRegisters(source);
        const scan = {
            entries: [
                {
                    id: 'outdoor_temp',
                    address: 1000,
                    status: 'present',
                    reads: { 4: { ok: true }, 3: { ok: true } },
                },
                {
                    id: 'charging_pump_status',
                    address: 1104,
                    status: 'unavailable',
                    reads: { 4: { ok: true }, 3: { ok: false } },
                },
                {
                    id: 'hc_g_flow_temp',
                    address: 1362,
                    status: 'absent',
                    reads: { 4: { ok: false }, 3: { ok: false } },
                },
            ],
        } as unknown as ScanResult;
        applyDeviceScan(registers, scan);
        const byId = new Map(registers.map(r => [r.id, r]));
        expect(byId.get('outdoor_temp')).to.deep.include({
            verified: 'device',
            deviceStatus: 'present',
            deviceFc: [4, 3],
        });
        expect(byId.get('charging_pump_status')).to.deep.include({
            verified: 'doc',
            deviceStatus: 'unavailable',
            deviceFc: [4],
        });
        expect(byId.get('hc_g_flow_temp')).to.deep.include({ verified: 'doc', deviceStatus: 'absent', deviceFc: [] });
        expect(byId.get('storage_temp')).to.deep.include({ verified: 'doc', deviceStatus: null, deviceFc: null });
    });
});
