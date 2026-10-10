import { expect } from 'chai';
import { activeRegisters, loadRegisters, type PlantConfig } from './registers/plant';
import type { RegisterEntry } from './registers/types';
import { commonFor, parentChannelIds, roleFor, stateIdFor, toStateValue } from './state-model';

const nav20 = loadRegisters('nav20') as RegisterEntry[];
const reg = (id: string): RegisterEntry => nav20.find(r => r.id === id) as RegisterEntry;
const empty: PlantConfig = {
    heatingCircuits: [],
    zoneModules: 0,
    roomsPerZone: 8,
    blocks: { solar: false, isc: false, cascade: false, bivalence: false, pv: false, booster: false },
};

/** Roles that exist in the ioBroker role catalogue and that we use (CLAUDE.md rule 21). */
const ALLOWED_ROLES = [
    'value',
    'value.temperature',
    'value.humidity',
    'value.power',
    'value.energy',
    'value.battery',
    'indicator',
];

describe('state ids', () => {
    it('follows the object tree of the spec', () => {
        expect(stateIdFor(reg('outdoor_temp'))).to.equal('system.outdoor_temp');
        expect(stateIdFor(reg('hp_flow_temp'))).to.equal('hp.hp_flow_temp');
        expect(stateIdFor(reg('hc_a_flow_temp'))).to.equal('hc.A.flow_temp');
        expect(stateIdFor(reg('hc_g_room_setpoint_cool_eco'))).to.equal('hc.G.room_setpoint_cool_eco');
        expect(stateIdFor(reg('zm1_room3_temp'))).to.equal('zones.1.rooms.3.temp');
        expect(stateIdFor(reg('zm10_room9_relay'))).to.equal('zones.10.rooms.9.relay');
        expect(stateIdFor(reg('zm2_mode_heat_cool'))).to.equal('zones.2.mode_heat_cool');
        expect(stateIdFor(reg('pv_surplus'))).to.equal('pv.pv_surplus');
    });

    it('is unique for every register of the family', () => {
        const ids = nav20.map(stateIdFor);
        expect(new Set(ids).size).to.equal(ids.length);
    });

    it('lists every parent channel outermost first', () => {
        expect(parentChannelIds('hc.A.flow_temp')).to.deep.equal(['hc', 'hc.A']);
        expect(parentChannelIds('zones.1.rooms.3.temp')).to.deep.equal([
            'zones',
            'zones.1',
            'zones.1.rooms',
            'zones.1.rooms.3',
        ]);
        expect(parentChannelIds('system.outdoor_temp')).to.deep.equal(['system']);
    });
});

describe('roles and common', () => {
    it('only uses roles of the catalogue', () => {
        for (const r of nav20) {
            expect(ALLOWED_ROLES, `${r.id}: ${roleFor(r)}`).to.include(roleFor(r));
        }
    });
    it('maps units to roles', () => {
        expect(roleFor(reg('outdoor_temp'))).to.equal('value.temperature');
        expect(roleFor(reg('humidity_sensor'))).to.equal('value.humidity');
        expect(roleFor(reg('current_power'))).to.equal('value.power');
        expect(roleFor(reg('energy_total'))).to.equal('value.energy');
        expect(roleFor(reg('battery_soc'))).to.equal('value.battery');
        expect(roleFor(reg('heating_demand'))).to.equal('indicator');
        expect(roleFor(reg('system_mode'))).to.equal('value');
    });
    it('creates read-only number states with unit, range and translated enum texts', () => {
        const common = commonFor(reg('system_mode'));
        expect(common).to.deep.include({ type: 'number', read: true, write: false, min: 0, max: 5 });
        expect((common.states as Record<string, string>)['2']).to.equal('Away');
        expect((commonFor(reg('system_mode'), false, 'de').states as Record<string, string>)['2']).to.equal('Abwesend');
        expect((commonFor(reg('system_mode'), false, 'xx').states as Record<string, string>)['2']).to.equal('Away');
        // plain strings only: translated objects would show up as [object Object] in the admin
        expect(
            Object.values(common.states as Record<string, unknown>).every(text => typeof text === 'string'),
        ).to.equal(true);
        expect(commonFor(reg('outdoor_temp'))).to.deep.include({ unit: '°C', role: 'value.temperature' });
    });
});

describe('writable states', () => {
    it('use control roles and set write, read-only states stay read-only', () => {
        expect(commonFor(reg('hc_a_room_setpoint_heat_normal'), true)).to.deep.include({
            write: true,
            read: true,
            role: 'level.temperature',
            type: 'number',
            unit: '°C',
        });
        expect(commonFor(reg('system_mode'), true)).to.deep.include({ write: true, role: 'level', type: 'number' });
        expect(commonFor(reg('system_mode'))).to.deep.include({ write: false, role: 'value' });
        expect(commonFor(reg('error_acknowledge'), true)).to.deep.include({
            write: true,
            read: false,
            role: 'button',
            type: 'boolean',
        });
        expect(commonFor(reg('demand_heating'), true)).to.deep.include({
            write: true,
            role: 'switch',
            type: 'boolean',
        });
    });
});

describe('state values', () => {
    it('makes indicators boolean, rounds floats and keeps null', () => {
        expect(commonFor(reg('heating_demand'))).to.deep.include({ type: 'boolean', role: 'indicator' });
        expect(toStateValue(reg('heating_demand'), 1)).to.equal(true);
        expect(toStateValue(reg('heating_demand'), 0)).to.equal(false);
        expect(toStateValue(reg('outdoor_temp'), 12.128373146057129)).to.equal(12.1); // temperatures: one decimal
        expect(toStateValue(reg('outdoor_temp'), 12.25)).to.equal(12.3);
        expect(toStateValue(reg('energy_heating'), 1234.5678)).to.equal(1234.6); // counters: one decimal
        expect(toStateValue(reg('power_consumption_hp'), 1.23456)).to.equal(1.235); // other values keep three
        expect(toStateValue(reg('system_mode'), 2)).to.equal(2);
        expect(toStateValue(reg('outdoor_temp'), null)).to.equal(null);
    });
});

describe('active registers', () => {
    it('enables nothing optional for an empty plant', () => {
        const ids = activeRegisters(nav20, empty).map(r => r.id);
        expect(ids).to.include('outdoor_temp');
        expect(ids).to.not.include('hc_a_flow_temp');
        expect(ids).to.not.include('zm1_room1_temp');
        expect(ids).to.not.include('solar_collector_temp');
        expect(ids).to.not.include('pv_surplus');
        expect(ids).to.not.include('bivalence_state');
        expect(ids).to.not.include('ext_outdoor_temp'); // write-only
    });
    it('follows heating circuits, zones, rooms and blocks', () => {
        const plant: PlantConfig = {
            ...empty,
            heatingCircuits: ['A', 'B'],
            zoneModules: 2,
            roomsPerZone: 2,
            blocks: { ...empty.blocks, solar: true, pv: true },
        };
        const ids = activeRegisters(nav20, plant).map(r => r.id);
        expect(ids).to.include.members([
            'hc_a_flow_temp',
            'hc_b_mode',
            'zm2_room2_temp',
            'zm1_mode_heat_cool',
            'solar_collector_temp',
            'pv_surplus',
        ]);
        expect(ids).to.not.include.members([
            'hc_c_flow_temp',
            'zm3_room1_temp',
            'zm1_room3_temp',
            'cascade_available_heating',
        ]);
        expect(ids).to.include('zm1_room9_relay'); // A9 belongs to the module, not to a configured room
    });
});
