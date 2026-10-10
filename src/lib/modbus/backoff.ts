import { RECONNECT_INITIAL_MS, RECONNECT_MAX_MS } from '../constants';

/**
 * Next reconnect wait: 5 s, then doubling up to 60 s.
 *
 * @param previousMs the previous wait, or `null` after a healthy connection
 */
export function nextReconnectDelayMs(previousMs: number | null): number {
    return previousMs === null ? RECONNECT_INITIAL_MS : Math.min(previousMs * 2, RECONNECT_MAX_MS);
}
