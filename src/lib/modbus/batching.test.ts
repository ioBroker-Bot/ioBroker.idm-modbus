import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RegisterEntry } from '../registers/types';
import { buildReadBlocks, readFunctionCode } from './batching';

const nav20 = (
    JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'registers', 'nav20.json'), 'utf8')) as {
        registers: RegisterEntry[];
    }
).registers;
const byId = (...ids: string[]): RegisterEntry[] => nav20.filter(r => ids.includes(r.id));

describe('buildReadBlocks', () => {
    it('maps access to function codes', () => {
        expect(readFunctionCode({ access: 'R' })).to.equal(4);
        expect(readFunctionCode({ access: 'RW' })).to.equal(3);
        expect(readFunctionCode({ access: 'W' })).to.equal(null);
    });

    it('bundles exactly adjacent registers and does not bridge gaps', () => {
        // 1050..1066 are FLOATs on every second address -> one block of 18 words
        const blocks = buildReadBlocks(
            byId(
                'hp_flow_temp',
                'hp_return_temp',
                'hgl_flow_temp',
                'heat_source_inlet_temp',
                'heat_source_outlet_temp',
                'air_intake_temp',
                'air_heat_exchanger_temp',
                'air_intake_temp_2',
                'charging_sensor_temp',
            ),
        );
        expect(blocks).to.have.length(1);
        expect(blocks[0]).to.include({ fc: 4, start: 1050, count: 18 });
        expect(blocks[0].items[2]).to.deep.include({ offset: 4 });

        const gap = buildReadBlocks(byId('outdoor_temp', 'storage_temp'));
        expect(gap).to.have.length(2);
    });

    it('splits by the documented function code when the device facts are not used', () => {
        const mixed = buildReadBlocks(
            byId('hp_operating_mode', 'heating_demand', 'cooling_demand'),
            undefined,
            undefined,
            false,
        );
        expect(mixed).to.have.length(1); // 1090..1092 all R, adjacent
        const rw = buildReadBlocks(
            byId('demand_heating', 'demand_cooling', 'demand_dhw_charging'),
            undefined,
            undefined,
            false,
        );
        expect(rw).to.have.length(1);
        expect(rw[0].fc).to.equal(3);
        // a read-only register and a read/write register next to each other need two requests with the documented codes
        const room = buildReadBlocks(byId('zm1_room1_mode', 'zm1_room1_relay'), undefined, undefined, false);
        expect(room.map(b => `${b.fc}:${b.start}x${b.count}`)).to.deep.equal(['3:2007x1', '4:2008x1']);
    });

    it('splits by the word limit', () => {
        const limited = buildReadBlocks(
            nav20.filter(r => /^hc_[a-g]_flow_temp$/.test(r.id)),
            4,
        );
        expect(limited.map(b => b.count)).to.deep.equal([4, 4, 4, 2]);
    });

    it('uses one function code for neighbours that the device answers on both, but reads humidity, mode and relay of a room one by one', () => {
        // found at the device: the humidity is a FLOAT over 2006-2007 there, so a block that spans humidity and mode returns wrong data
        const room = buildReadBlocks(nav20.filter(r => r.group === 'zones' && r.instance === '1' && r.room === '1'));
        expect(room.map(b => `${b.fc}:${b.start}x${b.count}`)).to.deep.equal([
            '4:2002x4',
            '4:2006x1',
            '4:2007x1',
            '4:2008x1',
        ]);
        expect(room[0].items.map(i => i.reg.id.replace('zm1_room1_', ''))).to.deep.equal(['temp', 'setpoint']);
    });

    it('bundles neighbours of other polling groups but only sends a request when something is due', () => {
        const room = nav20.filter(r => r.group === 'zones' && r.instance === '1' && r.room === '1');
        const dueMedium = new Set(room.filter(r => r.poll === 'medium').map(r => r.id));
        const blocks = buildReadBlocks(room, undefined, dueMedium);
        expect(blocks.map(b => `${b.start}x${b.count}`)).to.deep.equal(['2002x4', '2006x1', '2008x1']); // the mode is not due, humidity and relay stand alone
        expect(blocks[0].items.map(i => i.reg.poll)).to.include('config'); // the setpoint rides along with the temperature
        expect(buildReadBlocks(room, undefined, new Set())).to.deep.equal([]);
    });

    it('never bridges addresses that are not registers of the candidate list', () => {
        // circuit A and C are separated by the (not selected) circuit B registers
        const blocks = buildReadBlocks(byId('hc_a_flow_temp', 'hc_c_flow_temp'));
        expect(blocks.map(b => `${b.start}x${b.count}`)).to.deep.equal(['1350x2', '1354x2']);
    });

    it('needs far fewer requests for the zone module of the test installation than one request per value', () => {
        const plant = nav20.filter(
            r => r.access !== 'W' && (r.group !== 'zones' || (r.instance === '1' && Number(r.room ?? 0) <= 8)),
        );
        const medium = new Set(plant.filter(r => r.poll === 'medium' && r.group === 'zones').map(r => r.id));
        const requests = buildReadBlocks(
            plant.filter(r => r.group === 'zones'),
            undefined,
            medium,
        ).length;
        expect(requests).to.be.at.most(24); // at most 3 requests per room: temperature with setpoint, humidity, relay (humidity and mode must be read alone)
    });

    it('reads overlapping registers (1392, 1393, 1441, 1442, 1483, 1484) one by one', () => {
        const blocks = buildReadBlocks(byId('humidity_sensor', 'hc_a_mode', 'hc_b_mode'));
        const starts = blocks.map(b => `${b.start}:${b.count}`);
        expect(starts).to.deep.equal(['1392:2', '1393:1', '1394:1']);
    });

    it('skips write-only registers', () => {
        expect(buildReadBlocks(byId('ext_outdoor_temp', 'error_acknowledge'))).to.deep.equal([]);
    });

    it('covers every readable nav20 register exactly once, within the word limit', () => {
        const blocks = buildReadBlocks(nav20);
        const covered = blocks.flatMap(b => b.items.map(i => i.reg.id));
        const readable = nav20.filter(r => r.access !== 'W').map(r => r.id);
        expect([...covered].sort()).to.deep.equal([...readable].sort());
        expect(Math.max(...blocks.map(b => b.count))).to.be.at.most(40);
    });
});
