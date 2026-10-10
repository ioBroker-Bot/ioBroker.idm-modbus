import { expect } from 'chai';
import { readControlSettings, type ControlSettings } from '../config';
import { loadRegisters } from '../registers/plant';
import type { RegisterEntry } from '../registers/types';
import { isWritable } from './groups';

const nav20 = loadRegisters('nav20') as RegisterEntry[];
const none: ControlSettings = readControlSettings({});
const writable = (control: ControlSettings): string[] => nav20.filter(r => isWritable(r, control)).map(r => r.id);

describe('writable groups', () => {
    it('nothing is writable by default', () => {
        expect(none).to.deep.include({
            system: false,
            dhw: false,
            heatingCircuits: [],
            expert: false,
            solar: false,
            minEepromIntervalMs: 60000,
            dailyWarnThreshold: 24,
        });
        expect(writable(none)).to.deep.equal([]);
    });

    it('opens exactly the groups that are switched on', () => {
        expect(writable({ ...none, system: true })).to.have.members(['system_mode', 'error_acknowledge']);
        expect(writable({ ...none, dhw: true })).to.have.members([
            'dhw_setpoint',
            'dhw_charge_on_temp',
            'dhw_charge_off_temp',
        ]);
        expect(writable({ ...none, solar: true })).to.deep.equal(['solar_mode']);
        const expert = writable({ ...none, expert: true });
        expect(expert).to.include.members([
            'bivalence_point_1_2nd_gen',
            'cascade_min_power_heating',
            'cascade_bivalence_dhw_alternative',
        ]);
        expect(expert).to.have.length(16);
    });

    it('opens only the settings (read/write) of the chosen heating circuits', () => {
        const circuitB = writable({ ...none, heatingCircuits: ['B'] });
        expect(circuitB).to.include.members([
            'hc_b_mode',
            'hc_b_heating_curve',
            'hc_b_room_setpoint_cool_eco',
            'hc_b_parallel_shift',
        ]);
        expect(circuitB.every(id => id.startsWith('hc_b_'))).to.equal(true);
        expect(circuitB).to.not.include.members(['hc_b_flow_temp', 'hc_b_room_temp', 'hc_b_active_mode']); // sensors stay read-only
        expect(circuitB).to.have.length(11);
    });

    it('never opens sensors, GLT inputs, zone module values, PV values or energy counters', () => {
        const everything = writable({
            system: true,
            dhw: true,
            heatingCircuits: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
            zones: false,
            expert: true,
            solar: true,
            minEepromIntervalMs: 60000,
            dailyWarnThreshold: 24,
            warnings: [],
        });
        for (const id of everything) {
            const r = nav20.find(x => x.id === id) as RegisterEntry;
            expect(['system', 'dhw', 'hc', 'bivalence', 'cascade', 'solar'], id).to.include(r.group);
        }
        expect(
            everything.filter(
                id => id.startsWith('zm') || id.startsWith('ext_') || id.startsWith('glt_') || id.startsWith('demand_'),
            ),
        ).to.deep.equal([]);
    });

    it('opens only setpoint and operating mode of the rooms when zone control is on, never temperature or humidity', () => {
        const zones = writable({ ...none, zones: true });
        expect(zones).to.include.members([
            'zm1_room1_setpoint',
            'zm1_room1_mode',
            'zm10_room8_setpoint',
            'zm10_room8_mode',
        ]);
        expect(zones.every(id => /^zm\d+_room\d+_(setpoint|mode)$/.test(id))).to.equal(true);
        expect(zones).to.have.length(2 * 8 * 10);
        expect(zones).to.not.include.members([
            'zm1_room1_temp',
            'zm1_room1_humidity',
            'zm1_room1_relay',
            'zm1_mode_heat_cool',
            'zm1_room9_relay',
        ]);
        expect(writable(none).some(id => id.startsWith('zm'))).to.equal(false);
    });

    it('limits the control settings to safe values', () => {
        const settings = readControlSettings({
            eepromMinIntervalS: 2,
            dailyWriteWarn: 0,
            writeHcC: true,
            writeSolar: true,
        });
        expect(settings.minEepromIntervalMs).to.equal(10000); // never below the protective minimum
        expect(settings.dailyWarnThreshold).to.equal(24);
        expect(settings.heatingCircuits).to.deep.equal(['C']);
        expect(settings.warnings).to.have.length(2);
        expect(readControlSettings({ eepromMinIntervalS: 300 }).minEepromIntervalMs).to.equal(300000);
    });
});
