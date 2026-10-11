import { expect } from 'chai';
import { loadRegisters } from './registers/plant';
import type { RegisterEntry } from './registers/types';
import { interpretWords, shouldWrite } from './value';

const nav20 = loadRegisters('nav20') as RegisterEntry[];
const reg = (id: string): RegisterEntry => nav20.find(r => r.id === id) as RegisterEntry;

describe('interpretWords', () => {
    it('decodes valid values', () => {
        expect(interpretWords(reg('outdoor_temp'), [0x0000, 0x41ac], 'lowFirst')).to.deep.equal({
            value: 21.5,
            valid: true,
        });
        expect(interpretWords(reg('system_mode'), [1], 'lowFirst')).to.deep.equal({ value: 1, valid: true });
    });
    it('marks the Navigator "not available" markers invalid (measured at the device)', () => {
        // INT16 sentinel -1 (pumps), 0xFFFF in unsigned status registers, -1.0 for missing FLOAT sensors
        expect(interpretWords(reg('charging_pump_status'), [0xffff], 'lowFirst').valid).to.equal(false);
        expect(interpretWords(reg('compressor_status_2'), [0xffff], 'lowFirst').valid).to.equal(false);
        expect(interpretWords(reg('variable_input'), [0xffff], 'lowFirst').valid).to.equal(false);
        expect(interpretWords(reg('hc_a_room_temp'), [0x0000, 0xbf80], 'lowFirst')).to.deep.equal({
            value: null,
            valid: false,
        });
        expect(interpretWords(reg('humidity_sensor'), [0x0000, 0xbf80], 'lowFirst').valid).to.equal(false);
    });
    it('rejects values outside the documented range', () => {
        expect(interpretWords(reg('hp_sum_alarm'), [9], 'lowFirst').valid).to.equal(false);
        expect(interpretWords(reg('dhw_setpoint'), [20], 'lowFirst').valid).to.equal(false); // documented 35..95
    });
    it('treats an undecodable word count as invalid', () => {
        expect(interpretWords(reg('outdoor_temp'), [1], 'lowFirst').valid).to.equal(false);
    });
});

describe('Navigator 10 "not available" words', () => {
    // read-only capture at a Navigator 10 controller, published by Xerolux (idm-heatpump-api, docs/Register-Map-Invariants.md);
    // the same raw words must never become values here
    const nav10 = loadRegisters('nav10') as RegisterEntry[];
    const captured: [number, number[]][] = [
        [1006, [0xffff]], // variable input
        [1650, [0x0000, 0xbf80]], // heating circuit A external room temperature (-1.0)
        [1692, [0x0000, 0xbf80]], // external humidity (-1.0)
        [1714, [0xfffe]], // external groundwater pump demand
        [1715, [0xfffe]],
        [86, [0xffff]], // battery state of charge
        [4001, [0xffff]], // booster fault
        [1392, [0x0000, 0xbf80]], // humidity sensor (-1.0)
        [1147, [0xffff]], // cascade available for heating
    ];
    it('are all invalid', () => {
        for (const [address, words] of captured) {
            const entry = nav10.find(r => r.address === address) as RegisterEntry;
            expect(interpretWords(entry, words, 'lowFirst').valid, `${address} ${entry.id}`).to.equal(false);
        }
    });
});

describe('shouldWrite', () => {
    const float = { type: 'FLOAT' } as const;
    const uchar = { type: 'UCHAR' } as const;
    it('writes the first value and every change', () => {
        expect(shouldWrite(uchar, undefined, 1, 0)).to.equal(true);
        expect(shouldWrite(uchar, 1, 1, 0)).to.equal(false);
        expect(shouldWrite(uchar, 1, 2, 0)).to.equal(true);
        expect(shouldWrite(uchar, 1, null, 0)).to.equal(true);
        expect(shouldWrite(uchar, null, null, 0)).to.equal(false);
    });
    it('applies a 0.01 deadband to FLOAT values', () => {
        expect(shouldWrite(float, 21.5, 21.505, 0)).to.equal(false);
        expect(shouldWrite(float, 21.5, 21.52, 0)).to.equal(true);
    });
    it('refreshes after 10 unchanged cycles', () => {
        expect(shouldWrite(uchar, 1, 1, 9)).to.equal(false);
        expect(shouldWrite(uchar, 1, 1, 10)).to.equal(true);
    });
});
