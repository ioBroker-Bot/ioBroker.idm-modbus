import { expect } from 'chai';
import { decodeWords, encodeValue } from './codec';

/** Reference value: 21.5 = 0x41AC0000 -> high word 0x41AC, low word 0x0000. */
describe('codec', () => {
    it('decodes FLOAT low-word-first (IDM Reg_L first)', () => {
        expect(decodeWords('FLOAT', [0x0000, 0x41ac], 'lowFirst')).to.equal(21.5);
        expect(decodeWords('FLOAT', [0x41ac, 0x0000], 'highFirst')).to.equal(21.5);
    });
    it('round-trips FLOAT in both orders', () => {
        for (const order of ['lowFirst', 'highFirst'] as const) {
            const encoded = encodeValue('FLOAT', -12.25, order);
            expect(encoded.ok && decodeWords('FLOAT', encoded.value, order)).to.equal(-12.25);
        }
    });
    it('rejects non-finite FLOAT results and wrong word counts', () => {
        expect(decodeWords('FLOAT', [0x0000, 0x7fc0], 'lowFirst')).to.equal(null);
        expect(decodeWords('FLOAT', [1], 'lowFirst')).to.equal(null);
        expect(decodeWords('UCHAR', [1, 2], 'lowFirst')).to.equal(null);
    });
    it('treats INT16 as signed (pump status -1, bivalence -10) and UINT16/UCHAR as unsigned', () => {
        expect(decodeWords('INT16', [0xffff], 'lowFirst')).to.equal(-1);
        expect(decodeWords('INT16', [0xfff6], 'lowFirst')).to.equal(-10);
        expect(decodeWords('UINT16', [0xfff6], 'lowFirst')).to.equal(65526);
        expect(decodeWords('UCHAR', [46], 'lowFirst')).to.equal(46);
    });
    it('encodes integers and validates their range', () => {
        expect(encodeValue('INT16', -10, 'lowFirst')).to.deep.equal({ ok: true, value: [0xfff6] });
        expect(encodeValue('UCHAR', 255, 'lowFirst')).to.deep.equal({ ok: true, value: [255] });
        expect(encodeValue('UCHAR', 256, 'lowFirst')).to.have.property('ok', false);
        expect(encodeValue('BOOL', 2, 'lowFirst')).to.have.property('ok', false);
        expect(encodeValue('UCHAR', 1.5, 'lowFirst')).to.have.property('ok', false);
        expect(encodeValue('FLOAT', NaN, 'lowFirst')).to.have.property('ok', false);
    });
});
