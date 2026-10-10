import { expect } from 'chai';
import { MAX_TIMER_MS } from './constants';
import { clampTimerMs } from './timers';

describe('clampTimerMs', () => {
    it('passes a sane value through', () => {
        expect(clampTimerMs(3000, 1000)).to.equal(3000);
    });
    it('falls back for NaN, strings and undefined', () => {
        expect(clampTimerMs(NaN, 1000)).to.equal(1000);
        expect(clampTimerMs('3000', 1000)).to.equal(1000);
        expect(clampTimerMs(undefined, 1000)).to.equal(1000);
    });
    it('enforces the lower bound', () => {
        expect(clampTimerMs(10, 1000, 100)).to.equal(100);
        expect(clampTimerMs(-5, 1000)).to.equal(0);
    });
    it('caps at the 32-bit timer limit', () => {
        expect(clampTimerMs(1e12, 1000)).to.equal(MAX_TIMER_MS);
    });
});
