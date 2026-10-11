/** Deterministic timers for tests: nothing runs until `advance` moves the clock. */
export class ManualTimers {
    public time = 0;
    private nextHandle = 1;
    private readonly timers = new Map<number, { at: number; cb: () => void }>();

    public setTimeout = (cb: () => void, ms: number): unknown => {
        const handle = this.nextHandle++;
        this.timers.set(handle, { at: this.time + ms, cb });
        return handle;
    };
    public clearTimeout = (handle: unknown): void => {
        this.timers.delete(handle as number);
    };
    public delay = (ms: number): Promise<void> => new Promise<void>(resolve => this.setTimeout(resolve, ms));
    public now = (): number => this.time;

    /** Let pending promises settle. */
    public async flush(): Promise<void> {
        for (let i = 0; i < 20; i++) {
            await new Promise<void>(resolve => setImmediate(resolve));
        }
    }

    /**
     * Move the clock forward, firing due timers in order.
     *
     * @param ms milliseconds to advance
     */
    public async advance(ms: number): Promise<void> {
        const target = this.time + ms;
        for (;;) {
            await this.flush();
            const due = [...this.timers.entries()]
                .filter(([, t]) => t.at <= target)
                .sort((a, b) => a[1].at - b[1].at)[0];
            if (!due) {
                break;
            }
            this.timers.delete(due[0]);
            this.time = Math.max(this.time, due[1].at);
            due[1].cb();
        }
        this.time = target;
        await this.flush();
    }
}
