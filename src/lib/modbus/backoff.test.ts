import { expect } from 'chai';
import { nextReconnectDelayMs } from './backoff';

describe('nextReconnectDelayMs', () => {
    it('starts at 5 s, doubles and caps at 60 s', () => {
        const seq = [null as number | null];
        for (let i = 0; i < 6; i++) {
            seq.push(nextReconnectDelayMs(seq[seq.length - 1]));
        }
        expect(seq.slice(1)).to.deep.equal([5000, 10000, 20000, 40000, 60000, 60000]);
    });
});
