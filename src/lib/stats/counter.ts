/** Result of feeding a counter value. */
export type CounterStep = { delta: number } | { discontinuity: 'first' | 'invalid' | 'time' | 'reset' | 'jump' };

/** State of a counter tracker that survives restarts. */
export interface CounterMemory {
    /** time of the last accepted value in ms */
    at: number;
    /** last accepted value in kWh */
    value: number;
}

/**
 * Turns a cumulative energy counter (kWh) into energy deltas. Counters keep counting while the adapter is stopped, so the
 * delta across a gap is real energy - as long as it is physically possible. A decreasing value (meter replaced, overflow)
 * or a jump larger than the plant could have produced is treated as a discontinuity: the delta is dropped and the counter
 * becomes the new baseline.
 */
export class CounterTracker {
    private last: CounterMemory | null = null;

    /** @param maxKw highest power the metered plant can have; bounds the plausible delta */
    public constructor(private readonly maxKw: number) {}

    /**
     * Feed one counter reading.
     *
     * @param at time of the reading in ms
     * @param value counter value in kWh, or `null` when missing
     */
    public add(at: number, value: number | null): CounterStep {
        if (value === null || !Number.isFinite(value) || value < 0) {
            return { discontinuity: 'invalid' };
        }
        const previous = this.last;
        if (!previous) {
            this.last = { at, value };
            return { discontinuity: 'first' };
        }
        if (at <= previous.at) {
            return { discontinuity: 'time' };
        }
        const delta = value - previous.value;
        this.last = { at, value };
        if (delta < 0) {
            return { discontinuity: 'reset' };
        }
        const hours = (at - previous.at) / 3600000;
        if (delta > this.maxKw * hours * 1.5 + 0.05) {
            return { discontinuity: 'jump' };
        }
        return { delta };
    }

    /** The state to persist. */
    public get memory(): CounterMemory | null {
        return this.last ? { ...this.last } : null;
    }

    /**
     * Restore a persisted state.
     *
     * @param memory what {@link memory} returned earlier
     */
    public restore(memory: CounterMemory | null | undefined): void {
        this.last = memory && Number.isFinite(memory.at) && Number.isFinite(memory.value) ? { ...memory } : null;
    }
}
