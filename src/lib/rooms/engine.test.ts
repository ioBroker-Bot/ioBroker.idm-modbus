import { expect } from 'chai';
import type { RoomSource } from '../config';
import { decideRoomWrite } from './engine';

const NOW = 10_000_000;
const row = (extra: Partial<RoomSource> = {}): RoomSource => ({
    circuit: 'A',
    registerId: 'hc_a_ext_room_temp',
    stateId: 's',
    factor: 1,
    offset: 0,
    heartbeatMs: 300000,
    toleranceC: 0.2,
    min: 15,
    max: 30,
    maxAgeMs: 900000,
    onStale: 'stop',
    fixedValue: null,
    ...extra,
});
const fresh = (val: unknown): { val: unknown; ts: number } => ({ val, ts: NOW - 1000 });

describe('decideRoomWrite', () => {
    it('writes the first value, rounded to 0.1 °C, with factor and offset', () => {
        expect(decideRoomWrite(row(), fresh(21.04), NOW, undefined)).to.deep.equal({ write: 21, reason: 'first' });
        expect(decideRoomWrite(row({ factor: 0.1, offset: -1 }), fresh(225), NOW, undefined)).to.deep.equal({
            write: 21.5,
            reason: 'first',
        });
    });

    it('writes a change of the tolerance at once and a smaller one only at the heartbeat', () => {
        const last = { value: 21, at: NOW - 60000 };
        expect(decideRoomWrite(row(), fresh(21.2), NOW, last)).to.deep.equal({ write: 21.2, reason: 'changed' });
        expect(decideRoomWrite(row(), fresh(21.1), NOW, last)).to.deep.equal({ skip: 'unchanged' });
        expect(decideRoomWrite(row(), fresh(21.1), NOW, { value: 21, at: NOW - 301000 })).to.deep.equal({
            write: 21.1,
            reason: 'heartbeat',
        });
    });

    it('never writes values outside the range, missing values or non-numbers', () => {
        expect(decideRoomWrite(row(), fresh(14.9), NOW, undefined)).to.deep.equal({ skip: 'range' });
        expect(decideRoomWrite(row(), fresh(30.1), NOW, undefined)).to.deep.equal({ skip: 'range' });
        expect(decideRoomWrite(row(), fresh('abc'), NOW, undefined)).to.deep.equal({ skip: 'invalid' });
        expect(decideRoomWrite(row(), fresh(null), NOW, undefined)).to.deep.equal({ skip: 'invalid' });
        expect(decideRoomWrite(row(), undefined, NOW, undefined)).to.deep.equal({ skip: 'invalid' });
    });

    it('stops or writes the fixed value when the source is too old', () => {
        const old = { val: 21, ts: NOW - 1000000 };
        expect(decideRoomWrite(row(), old, NOW, undefined)).to.deep.equal({ skip: 'stale' });
        expect(decideRoomWrite(row({ onStale: 'fixed', fixedValue: 20 }), old, NOW, undefined)).to.deep.equal({
            write: 20,
            reason: 'fixed',
        });
    });
});
