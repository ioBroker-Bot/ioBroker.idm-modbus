/** A run shorter than this counts as a short cycle (a hint for too frequent starts). */
export const SHORT_RUN_MS = 10 * 60 * 1000;

/** Persisted state of one compressor. */
export interface CompressorData {
    /** local date the daily counters belong to */
    date: string;
    /** operating hours since the statistics started */
    hoursTotal: number;
    /** starts since the statistics started */
    startsTotal: number;
    /** operating hours today */
    hoursDay: number;
    /** starts today */
    startsDay: number;
    /** runs shorter than 10 minutes today */
    shortRunsDay: number;
    /** true/false = last known state, null = unknown */
    running: boolean | null;
    /** time of the last sample in ms */
    lastAt: number;
    /** start of the current run in ms (only while running) */
    runStart: number | null;
}

/** Runtime, starts and short cycles of one compressor, derived from its status register. */
export class CompressorTracker {
    private data: CompressorData = {
        date: '',
        hoursTotal: 0,
        startsTotal: 0,
        hoursDay: 0,
        startsDay: 0,
        shortRunsDay: 0,
        running: null,
        lastAt: 0,
        runStart: null,
    };

    /** @param maxGapMs longest interval that still counts as continuous operation */
    public constructor(private readonly maxGapMs: () => number) {}

    /**
     * Feed one status sample.
     *
     * @param at time of the sample in ms
     * @param date local date key of that time
     * @param running true = running, false = stopped, null = unknown or not present
     */
    public add(at: number, date: string, running: boolean | null): void {
        const d = this.data;
        if (d.date !== date) {
            d.date = date;
            d.hoursDay = 0;
            d.startsDay = 0;
            d.shortRunsDay = 0;
        }
        if (running === null) {
            d.running = null;
            d.runStart = null;
            d.lastAt = at;
            return;
        }
        if (at > d.lastAt && d.running === true && at - d.lastAt <= this.maxGapMs()) {
            const hours = (at - d.lastAt) / 3600000;
            d.hoursDay += hours;
            d.hoursTotal += hours;
        }
        if (running && d.running === false) {
            d.startsDay++;
            d.startsTotal++;
            d.runStart = at;
        } else if (running && d.running === null) {
            d.runStart = at;
        } else if (!running && d.running === true && d.runStart !== null && at - d.runStart < SHORT_RUN_MS) {
            d.shortRunsDay++;
        }
        if (!running) {
            d.runStart = null;
        }
        d.running = running;
        d.lastAt = at;
    }

    /** Current counters. */
    public get snapshot(): Readonly<CompressorData> {
        return this.data;
    }

    /** The state to persist. */
    public serialize(): CompressorData {
        return { ...this.data };
    }

    /**
     * Restore a persisted state; the run in progress is forgotten (it cannot be known after a restart).
     *
     * @param data what {@link serialize} returned earlier
     */
    public restore(data: Partial<CompressorData> | null | undefined): void {
        if (!data || typeof data.date !== 'string') {
            return;
        }
        const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
        this.data = {
            date: data.date,
            hoursTotal: num(data.hoursTotal),
            startsTotal: num(data.startsTotal),
            hoursDay: num(data.hoursDay),
            startsDay: num(data.startsDay),
            shortRunsDay: num(data.shortRunsDay),
            running: null,
            lastAt: 0,
            runStart: null,
        };
    }
}
