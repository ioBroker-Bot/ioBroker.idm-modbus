import type { NavigatorFamily } from './constants';
import type { Result } from './modbus/result';

/** Reads holding (3) or input (4) registers; the Modbus client behind it never throws. */
export type ProbeReader = (fc: 3 | 4, address: number, count: number) => Promise<Result<number[]>>;

/** What the probes found out. */
export interface Detection {
    /** the detected family, `null` when the probes do not allow a decision */
    family: NavigatorFamily | null;
    /** how sure the decision is */
    confidence: 'high' | 'medium' | 'low';
    /** the probes that led to it (addresses and outcomes only, no host) */
    evidence: string[];
}

/** One probe: answered with a value, refused by the device (Modbus exception) or inconclusive (timeout, offline, ...). */
type Outcome = { kind: 'answered'; word: number } | { kind: 'refused' } | { kind: 'inconclusive' };

/**
 * Find out which Navigator generation answers (read requests only, a handful of single reads).
 *
 * The register families are told apart by what the device refuses (Modbus exception 2), because the documents place different
 * registers at the same addresses:
 *
 * - Navigator 2.0 and 10 hold the system mode at 1005 (function code 3, 0-5); in Navigator 1.x that address lies inside a FLOAT of the
 *   read-only block and is refused for function code 3, while the 1.x system mode sits at 2000 (0-3).
 * - Navigator 10 additionally answers 88/90 (PV target value, smart grid status) and 1068; a Navigator 2.0 refuses them
 *   (88, 90 and 1068 were refused by the test device). 4001 is no evidence: the Navigator 2.0 test device answers it too.
 *
 * Only the Navigator 2.0 branch has been seen on a real device; the other two follow the IDM documents.
 *
 * @param read reads registers from the device
 */
export async function detectFamily(read: ProbeReader): Promise<Detection> {
    const evidence: string[] = [];
    const probe = async (fc: 3 | 4, address: number, count: number): Promise<Outcome> => {
        const result = await read(fc, address, count);
        let outcome: Outcome;
        if (result.ok) {
            outcome = { kind: 'answered', word: result.value[0] & 0xffff };
        } else if (result.error.kind === 'exception') {
            outcome = { kind: 'refused' };
        } else {
            outcome = { kind: 'inconclusive' };
        }
        evidence.push(`FC${fc} ${address}: ${outcome.kind}`);
        return outcome;
    };
    const plausible = (outcome: Outcome, max: number): boolean =>
        outcome.kind === 'answered' && ((outcome.word & 0xff) <= max || outcome.word === 0xffff);

    const systemMode = await probe(3, 1005, 1);
    if (systemMode.kind === 'inconclusive') {
        return { family: null, confidence: 'low', evidence };
    }
    if (systemMode.kind === 'answered' && plausible(systemMode, 5)) {
        // Navigator 2.0 or 10
        const extras = [await probe(4, 90, 1), await probe(3, 88, 2), await probe(4, 1068, 2)];
        if (extras.some(o => o.kind === 'inconclusive')) {
            return { family: null, confidence: 'low', evidence };
        }
        const answered = extras.map(o => o.kind === 'answered');
        if (answered[0] || answered[1]) {
            return { family: 'nav10', confidence: 'high', evidence };
        }
        if (answered[2]) {
            return { family: 'nav10', confidence: 'medium', evidence };
        }
        return { family: 'nav20', confidence: 'high', evidence };
    }
    // 1005 refused: Navigator 1.x has its system mode at 2000 and its error number at 1500
    const legacyMode = await probe(3, 2000, 1);
    const errorNumber = await probe(4, 1500, 1);
    if (legacyMode.kind === 'inconclusive' || errorNumber.kind === 'inconclusive') {
        return { family: null, confidence: 'low', evidence };
    }
    if (systemMode.kind === 'refused' && plausible(legacyMode, 3)) {
        return { family: 'nav17', confidence: errorNumber.kind === 'answered' ? 'high' : 'medium', evidence };
    }
    return { family: null, confidence: 'low', evidence };
}
