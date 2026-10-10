import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    compareWithPdfIndex,
    expandRegisters,
    loadFamilySource,
    type PdfIndex,
    type RegisterEntry,
} from '../../../tools/build-registers';
import { readFunctionCode } from '../modbus/batching';
import { interpretWords } from '../value';
import { activeRegisters, type PlantConfig } from './plant';

const root = path.join(__dirname, '..', '..', '..');
const pdfIndex = JSON.parse(fs.readFileSync(path.join(root, 'tools/sources/nav17.pdf-index.json'), 'utf8')) as PdfIndex;
const generated = JSON.parse(fs.readFileSync(path.join(__dirname, 'nav17.json'), 'utf8')) as {
    registers: RegisterEntry[];
};

describe('nav17 register file', () => {
    const registers = expandRegisters(loadFamilySource('nav17', root));
    const byId = new Map(registers.map(r => [r.id, r]));

    it('is up to date with the source file (run npm run build:registers -- nav17)', () => {
        expect(generated.registers).to.deep.equal(registers);
    });

    it('contains every PDF address with matching type, access and EEPROM flag', () => {
        expect(compareWithPdfIndex(registers, pdfIndex)).to.deep.equal([]);
        expect(registers.filter(r => r.verified === 'doc')).to.have.length(pdfIndex.rows.length);
    });

    it('has unique ids and addresses', () => {
        expect(new Set(registers.map(r => r.id)).size).to.equal(registers.length);
        expect(new Set(registers.map(r => r.address)).size).to.equal(registers.length);
    });

    it('is its own layout: the FLOAT block from 1000 and the address formulas of the 1.x table', () => {
        expect(byId.get('hp_flow_temp')?.address).to.equal(1002); // 2.0 has the averaged outdoor temperature there
        expect(byId.get('hc_g_flow_temp')?.address).to.equal(1028);
        expect(byId.get('hc_g_room_device_temp')?.address).to.equal(1042);
        expect(byId.get('hc_g_status')?.address).to.equal(1508);
        expect(byId.get('compressor_status_4')?.address).to.equal(1512);
        expect(byId.get('hc_g_operating_mode')?.address).to.equal(2014);
        expect(byId.get('hc_g_setpoint_flow_cooling')?.address).to.equal(2140);
        expect(byId.get('dhw_setpoint')).to.deep.include({ address: 2152, type: 'FLOAT', min: 35, max: 60 });
    });

    it('reads input registers with function code 4 and holding registers with 3, with no overlaps', () => {
        expect(readFunctionCode(byId.get('outdoor_temp') as RegisterEntry)).to.equal(4);
        expect(readFunctionCode(byId.get('system_mode_17') as RegisterEntry)).to.equal(3);
        expect(registers.filter(r => r.overlaps.length)).to.deep.equal([]);
    });

    it('treats every writable register as EEPROM-sensitive (the document warns about 300 000 cycles)', () => {
        const writable = registers.filter(r => r.access === 'RW' && r.verified === 'doc');
        expect(writable.length).to.be.greaterThan(60);
        expect(writable.every(r => r.eeprom)).to.equal(true);
    });

    it('marks the post-2016 PV supplement as community, not as a document fact', () => {
        const community = registers.filter(r => r.verified === 'community').map(r => r.id);
        expect(community).to.have.members([
            'pv_surplus',
            'electric_heater_power',
            'pv_production',
            'house_consumption',
            'power_consumption_hp',
        ]);
    });

    it('decodes status bytes that the firmware doubles into both bytes of the word', () => {
        const mode = byId.get('hp_operating_mode') as RegisterEntry;
        expect(interpretWords(mode, [0x0101], 'lowFirst')).to.deep.equal({ value: 1, valid: true });
        expect(interpretWords(mode, [0x0808], 'lowFirst')).to.deep.equal({ value: 8, valid: true });
        expect(interpretWords(mode, [0x0003], 'lowFirst')).to.deep.equal({ value: 3, valid: true });
        expect(interpretWords(mode, [0xffff], 'lowFirst')).to.deep.equal({ value: null, valid: false }); // not available
        expect(interpretWords(mode, [0x0909], 'lowFirst')).to.deep.equal({ value: null, valid: false }); // above the documented 8
    });

    it('enables the circuits and blocks that are configured, and has no zone modules', () => {
        const plant: PlantConfig = {
            heatingCircuits: ['A'],
            zoneModules: 2,
            roomsPerZone: 8,
            blocks: { solar: false, isc: false, cascade: false, bivalence: false, pv: false, booster: false },
        };
        const active = activeRegisters(registers, plant).map(r => r.id);
        expect(active).to.include('hc_a_flow_temp');
        expect(active).to.not.include('hc_b_flow_temp');
        expect(active).to.not.include('solar_collector_temp');
        expect(active.some(id => id.startsWith('zm'))).to.equal(false);
    });
});
