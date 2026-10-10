import { MAX_TIMER_MS } from './constants';

/**
 * Clamp a user-supplied timer delay into the range Node's timers handle correctly.
 *
 * @param value Delay in ms from the config (may be NaN, negative or huge)
 * @param fallback Delay in ms used when `value` is not a finite number
 * @param min Lower bound in ms (default 0)
 * @returns A delay in `[min, MAX_TIMER_MS]`
 */
export function clampTimerMs(value: unknown, fallback: number, min = 0): number {
    const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    return Math.min(Math.max(n, min), MAX_TIMER_MS);
}
