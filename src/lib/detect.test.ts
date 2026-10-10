import { expect } from 'chai';
import { detectFamily, type ProbeReader } from './detect';
import { fail, ok } from './modbus/result';

/**
 * A fake device: the answered addresses with their first word; everything else is refused with exception 2.
 *
 * @param answers answered `fc:address` keys and their value
 * @param broken `fc:address` keys that time out
 */
const device =
    (answers: Record<string, number>, broken: string[] = []): ProbeReader =>
    (fc, address, count) => {
        const key = `${fc}:${address}`;
        if (broken.includes(key)) {
            return Promise.resolve(fail('timeout', 'No response'));
        }
        return Promise.resolve(
            key in answers
                ? ok(Array.from({ length: count }, (_, i) => (i === 0 ? answers[key] : 0)))
                : { ok: false, error: { kind: 'exception', message: 'Modbus exception 2', exceptionCode: 2 } },
        );
    };

describe('detectFamily', () => {
    it('recognises a Navigator 2.0: system mode at 1005, nothing of the Navigator 10 registers (as the test device)', async () => {
        const detection = await detectFamily(device({ '3:1005': 1 }));
        expect(detection).to.deep.include({ family: 'nav20', confidence: 'high' });
        expect(detection.evidence.join(' ')).to.not.match(/\d+\.\d+\.\d+\.\d+/);
    });

    it('recognises a Navigator 10 by its PV target value or smart grid register, and with less confidence by the heat sink register', async () => {
        expect(await detectFamily(device({ '3:1005': 1, '4:90': 2 }))).to.deep.include({
            family: 'nav10',
            confidence: 'high',
        });
        expect(await detectFamily(device({ '3:1005': 1, '3:88': 0 }))).to.deep.include({
            family: 'nav10',
            confidence: 'high',
        });
        expect(await detectFamily(device({ '3:1005': 1, '4:1068': 0 }))).to.deep.include({
            family: 'nav10',
            confidence: 'medium',
        });
        // the Navigator 2.0 test device answers 4001 (with 0xFFFF), so that register decides nothing
        expect(await detectFamily(device({ '3:1005': 1, '4:4001': 0xffff }))).to.deep.include({
            family: 'nav20',
            confidence: 'high',
        });
    });

    it('recognises a Navigator 1.x: 1005 refused, system mode at 2000 (also doubled into both bytes), error number at 1500', async () => {
        expect(await detectFamily(device({ '3:2000': 1, '4:1500': 0 }))).to.deep.include({
            family: 'nav17',
            confidence: 'high',
        });
        expect(await detectFamily(device({ '3:2000': 0x0101, '4:1500': 0 }))).to.deep.include({
            family: 'nav17',
            confidence: 'high',
        });
        expect(await detectFamily(device({ '3:2000': 2 }))).to.deep.include({ family: 'nav17', confidence: 'medium' });
    });

    it('does not decide when nothing matches or a probe fails for other reasons than a refusal', async () => {
        expect(await detectFamily(device({}))).to.deep.include({ family: null });
        expect(await detectFamily(device({ '3:1005': 1 }, ['4:90']))).to.deep.include({
            family: null,
            confidence: 'low',
        });
        expect(await detectFamily(device({}, ['3:1005']))).to.deep.include({ family: null, confidence: 'low' });
        expect(await detectFamily(device({ '3:1005': 99 }))).to.deep.include({ family: null });
    });
});
