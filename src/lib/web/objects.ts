import type { PlannedObject } from '../object-tree';
import { localized } from '../translations';

/**
 * A channel object.
 *
 * @param id id relative to the instance
 * @param name English name (translated through the dictionary) or, with `translate` off, the text as it is
 * @param translate whether `name` is a dictionary text
 */
export function channelObject(id: string, name: string, translate = true): PlannedObject {
    return { id, object: { type: 'channel', common: { name: translate ? localized(name) : name }, native: {} } };
}

/**
 * A read-only state object with a translated name.
 *
 * @param id id relative to the instance
 * @param name English name (a dictionary text)
 * @param type value type
 * @param role ioBroker role
 * @param unit unit, if any
 */
export function stateObject(
    id: string,
    name: string,
    type: 'boolean' | 'string' | 'number',
    role: string,
    unit?: string,
): PlannedObject {
    return {
        id,
        object: {
            type: 'state',
            common: { name: localized(name), type, role, read: true, write: false, ...(unit ? { unit } : {}) },
            native: {},
        },
    };
}
