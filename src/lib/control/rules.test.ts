import { expect } from 'chai';
import { loadRegisters } from '../registers/plant';
import type { RegisterEntry } from '../registers/types';
import { checkWrite, toNumber, type WriteContext } from './rules';

const nav20 = loadRegisters('nav20') as RegisterEntry[];
const reg = (id: string): RegisterEntry => nav20.find(r => r.id === id) as RegisterEntry;
const context = (current: Record<string, number> = {}): WriteContext => ({
    current: id => current[id],
    floatWordOrder: 'lowFirst',
});

describe('toNumber', () => {
    it('accepts numbers, booleans and numeric strings and refuses everything else', () => {
        expect([1, true, false, '2', '2,5', ' 3 '].map(toNumber)).to.deep.equal([1, 1, 0, 2, 2.5, 3]);
        expect([NaN, Infinity, '', 'abc', null, undefined, {}].map(toNumber)).to.deep.equal([
            null,
            null,
            null,
            null,
            null,
            null,
            null,
        ]);
    });
});

describe('checkWrite', () => {
    it('encodes valid values for every register type', () => {
        expect(checkWrite(reg('system_mode'), 2, context())).to.deep.equal({ ok: true, value: 2, words: [2] });
        expect(checkWrite(reg('hc_a_mode'), '3', context())).to.deep.equal({ ok: true, value: 3, words: [3] });
        expect(checkWrite(reg('hc_a_room_setpoint_heat_normal'), 21.5, context())).to.deep.equal({
            ok: true,
            value: 21.5,
            words: [0x0000, 0x41ac],
        });
        expect(checkWrite(reg('bivalence_point_1_2nd_gen'), -10, context())).to.deep.equal({
            ok: true,
            value: -10,
            words: [0xfff6],
        });
        expect(checkWrite(reg('error_acknowledge'), true, context())).to.deep.equal({ ok: true, value: 1, words: [1] });
    });

    it('refuses read-only and unknown registers', () => {
        expect(checkWrite(reg('outdoor_temp'), 5, context())).to.include({ ok: false, reason: 'not-writable' });
        expect(checkWrite(undefined, 5, context())).to.include({ ok: false, reason: 'unknown-register' });
    });

    it('refuses values outside the documented range, at both ends', () => {
        const setpoint = reg('dhw_setpoint'); // 35..95
        expect(checkWrite(setpoint, 34.9, context())).to.include({ ok: false, reason: 'range' });
        expect(checkWrite(setpoint, 35, context())).to.include({ ok: true });
        expect(checkWrite(setpoint, 95, context())).to.include({ ok: true });
        expect(checkWrite(setpoint, 96, context())).to.include({ ok: false, reason: 'range' });
        expect(checkWrite(reg('hc_a_heating_curve'), 0.05, context())).to.include({ ok: false, reason: 'range' });
    });

    it('allows only the documented enum values (system mode has no 3)', () => {
        expect(checkWrite(reg('system_mode'), 3, context())).to.include({ ok: false, reason: 'not-allowed-value' });
        expect(checkWrite(reg('system_mode'), 6, context())).to.include({ ok: false, reason: 'not-allowed-value' });
        for (const mode of [0, 1, 2, 4, 5]) {
            expect(checkWrite(reg('system_mode'), mode, context())).to.include({ ok: true });
        }
        expect(checkWrite(reg('hc_b_mode'), 5, context())).to.include({ ok: true });
        expect(checkWrite(reg('solar_mode'), 5, context())).to.include({ ok: false, reason: 'not-allowed-value' });
    });

    it('refuses values that are not numbers or do not fit the type', () => {
        expect(checkWrite(reg('system_mode'), 'abc', context())).to.include({ ok: false, reason: 'not-a-number' });
        expect(checkWrite(reg('system_mode'), NaN, context())).to.include({ ok: false, reason: 'not-a-number' });
        expect(checkWrite(reg('hc_a_heating_limit'), 15.5, context())).to.include({ ok: false, reason: 'type' }); // UCHAR needs an integer
    });

    it('keeps the hot water switch-off temperature above the switch-on temperature', () => {
        // documented ranges: on 30..50, off 46..53
        const ctx = context({ dhw_charge_on_temp: 49, dhw_charge_off_temp: 50 });
        expect(checkWrite(reg('dhw_charge_off_temp'), 48, ctx)).to.include({ ok: false, reason: 'order' }); // in range, but below "on" (49)
        expect(checkWrite(reg('dhw_charge_off_temp'), 49, ctx)).to.include({ ok: false, reason: 'order' }); // equal is not above
        expect(checkWrite(reg('dhw_charge_off_temp'), 51, ctx)).to.include({ ok: true });
        expect(checkWrite(reg('dhw_charge_on_temp'), 50, ctx)).to.include({ ok: false, reason: 'order' });
        expect(checkWrite(reg('dhw_charge_on_temp'), 48, ctx)).to.include({ ok: true });
        // without a known partner value the rule cannot be applied and does not block
        expect(checkWrite(reg('dhw_charge_on_temp'), 49, context())).to.include({ ok: true });
    });

    it('rounds room setpoints to the 0.5 °C step and keeps them inside the protective range', () => {
        const setpoint = reg('zm1_room3_setpoint');
        expect(checkWrite(setpoint, 21.3, context())).to.include({ ok: true, value: 21.5 });
        expect(checkWrite(setpoint, 21.2, context())).to.include({ ok: true, value: 21 });
        expect(checkWrite(setpoint, 22, context())).to.include({ ok: true, value: 22 });
        // the range applies to the rounded value: 9.6 becomes 9.5 (below 10), 10.2 becomes 10, 29.8 becomes 30, 30.3 becomes 30.5
        expect(checkWrite(setpoint, 9.6, context())).to.include({ ok: false, reason: 'range' });
        expect(checkWrite(setpoint, 10.2, context())).to.include({ ok: true, value: 10 });
        expect(checkWrite(setpoint, 29.8, context())).to.include({ ok: true, value: 30 });
        expect(checkWrite(setpoint, 30.3, context())).to.include({ ok: false, reason: 'range' });
    });

    it('every writable register of the family can be written with its own default or minimum', () => {
        for (const r of nav20.filter(x => x.access !== 'R' && x.group !== 'zones')) {
            const probe = r.enum ? Number(Object.keys(r.enum)[0]) : (r.default ?? r.min ?? 0);
            const result = checkWrite(r, probe, context());
            expect(result.ok, `${r.id} with ${probe}: ${result.ok ? '' : result.message}`).to.equal(true);
        }
    });
});
