/** A value as the diagram needs it: number, text, boolean or `null` (no value). */
export type HubValue = number | string | boolean | null;

/**
 * Keeps the latest value of every state of the adapter and tells listeners about changes. The adapter feeds it from its single
 * choke point for state writes, the diagram server reads and subscribes.
 */
export class ValueHub {
    private readonly values = new Map<string, HubValue>();
    private readonly listeners = new Set<(id: string, value: HubValue) => void>();

    /**
     * Set a value; listeners hear about it only when it changed.
     *
     * @param id state id relative to the instance
     * @param value the new value
     */
    public set(id: string, value: HubValue): void {
        if (this.values.has(id) && this.values.get(id) === value) {
            return;
        }
        this.values.set(id, value);
        this.listeners.forEach(listener => listener(id, value));
    }

    /**
     * The latest value of a state.
     *
     * @param id state id relative to the instance
     */
    public get(id: string): HubValue | undefined {
        return this.values.get(id);
    }

    /**
     * Has the state a real value (not missing, not `null`)?
     *
     * @param id state id relative to the instance
     */
    public has(id: string): boolean {
        const value = this.values.get(id);
        return value !== undefined && value !== null;
    }

    /** A copy of all values. */
    public snapshot(): Record<string, HubValue> {
        return Object.fromEntries(this.values);
    }

    /**
     * Listen to changes.
     *
     * @param listener called with the state id and the new value
     * @returns a function that removes the listener
     */
    public subscribe(listener: (id: string, value: HubValue) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
}
