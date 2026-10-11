import type { PlannedObject } from '../object-tree';

/** What a managed set of objects needs from the adapter. */
export interface ObjectHost {
    /** create or update channels and states */
    createObjects(objects: PlannedObject[]): Promise<void>;
    /** ids (relative to the instance) of the existing objects below `prefix` */
    existingIds(prefix: string): Promise<string[]>;
    /** delete objects and their states */
    removeObjects(ids: string[]): Promise<void>;
}

/**
 * The objects below one prefix, kept equal to a plan: new ones are created, and ones that are no longer planned (a state that
 * Modbus delivers now, a part the plant lost, leftovers of an earlier version) are removed. The first call also takes in what an
 * earlier start left in the object tree.
 */
export class ManagedObjects {
    private readonly known = new Set<string>();
    private loaded = false;

    /**
     * @param host adapter services
     * @param prefix id of the channel the objects live in (without a trailing dot)
     */
    public constructor(
        private readonly host: ObjectHost,
        private readonly prefix: string,
    ) {}

    /**
     * Make the objects below the prefix match the plan.
     *
     * @param planned the objects that should exist
     */
    public async sync(planned: PlannedObject[]): Promise<void> {
        if (!this.loaded) {
            this.loaded = true;
            (await this.host.existingIds(this.prefix)).forEach(id => this.known.add(id));
        }
        const wanted = new Set(planned.map(object => object.id));
        const fresh = planned.filter(object => !this.known.has(object.id));
        if (fresh.length) {
            await this.host.createObjects(fresh);
            fresh.forEach(object => this.known.add(object.id));
        }
        const stale = [...this.known].filter(id => !wanted.has(id));
        if (stale.length) {
            await this.host.removeObjects(stale);
            stale.forEach(id => this.known.delete(id));
        }
    }
}
