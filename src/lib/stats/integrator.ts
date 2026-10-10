/**
 * Integrates a power signal into energy (trapezoid rule) and refuses to bridge gaps: after a connection loss or a stopped
 * adapter the power in between is unknown, and inventing it would put estimated values into the statistics.
 */
export class PowerIntegrator {
    private last: { at: number; kw: number } | null = null;

    /** @param maxGapMs longest interval between two samples that is still integrated */
    public constructor(private readonly maxGapMs: () => number) {}

    /**
     * Feed one power sample.
     *
     * @param at time of the sample in ms
     * @param kw power in kW, or `null` when the value is missing or invalid
     * @returns energy in kWh since the previous sample, or `null` when nothing can be integrated (first sample, invalid
     * value, time not advancing, gap too long)
     */
    public add(at: number, kw: number | null): number | null {
        if (kw === null || !Number.isFinite(kw) || kw < 0) {
            this.last = null;
            return null;
        }
        const previous = this.last;
        if (previous && at <= previous.at) {
            return null;
        }
        this.last = { at, kw };
        if (!previous || at - previous.at > this.maxGapMs()) {
            return null;
        }
        return ((previous.kw + kw) / 2) * ((at - previous.at) / 3600000);
    }
}
