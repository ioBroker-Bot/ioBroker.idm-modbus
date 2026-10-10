import type { RegisterEntry } from './registers/types';
import { commonFor, parentChannelIds, stateIdFor } from './state-model';
import { localized } from './translations';

/** An object the adapter creates, with its id relative to the instance namespace. */
export interface PlannedObject {
    /** id relative to the instance namespace */
    id: string;
    /** the object definition */
    object: ioBroker.SettableObject;
}

/** English names of the top-level channels; translations come from the dictionary (`translate:strings`). */
const GROUP_NAMES: Record<string, string> = {
    system: 'System',
    dhw: 'Hot water',
    hp: 'Heat pump',
    hc: 'Heating circuits',
    zones: 'Zone modules',
    energy: 'Energy',
    pv: 'Photovoltaics',
    glt: 'Building automation',
    solar: 'Solar',
    isc: 'ISC',
    cascade: 'Cascade',
    bivalence: 'Bivalence',
    booster: 'Booster',
};

/**
 * Display name of a channel.
 *
 * @param channelId relative channel id (`hc`, `hc.A`, `zones.1.rooms.3`, ...)
 * @param heatingCircuitNames user-defined names of heating circuits by letter
 */
function channelName(channelId: string, heatingCircuitNames: Record<string, string>): ioBroker.StringOrTranslated {
    const parts = channelId.split('.');
    if (parts.length === 1) {
        return localized(GROUP_NAMES[parts[0]] ?? parts[0]);
    }
    if (parts[0] === 'hc') {
        return heatingCircuitNames[parts[1]] ?? localized('Heating circuit {i}', { i: parts[1] });
    }
    if (parts[0] === 'zones') {
        if (parts.length === 2) {
            return localized('Zone module {z}', { z: parts[1] });
        }
        if (parts.length === 3) {
            return localized('Rooms');
        }
        return localized('Room {r}', { r: parts[3] });
    }
    return parts[parts.length - 1];
}

/**
 * All objects for a set of registers: every parent channel first (outermost first, no orphans), then the states.
 *
 * @param registers registers that get a state
 * @param heatingCircuitNames user-defined heating circuit names by letter
 * @param isWritable whether the user may write the state of a register (control enabled for its group)
 * @param language ioBroker system language for the texts of enum values
 */
export function planObjects(
    registers: readonly RegisterEntry[],
    heatingCircuitNames: Record<string, string>,
    isWritable: (reg: RegisterEntry) => boolean = () => false,
    language = 'en',
): PlannedObject[] {
    const channels = new Set<string>();
    const states: PlannedObject[] = [];
    for (const reg of registers) {
        const id = stateIdFor(reg);
        parentChannelIds(id).forEach(channel => channels.add(channel));
        states.push({
            id,
            object: {
                type: 'state',
                common: commonFor(reg, isWritable(reg), language),
                native: { address: reg.address },
            },
        });
    }
    const channelObjects = [...channels]
        .sort((a, b) => a.split('.').length - b.split('.').length || a.localeCompare(b))
        .map<PlannedObject>(id => ({
            id,
            object: { type: 'channel', common: { name: channelName(id, heatingCircuitNames) }, native: {} },
        }));
    return [...channelObjects, ...states];
}

/**
 * Objects to delete when the configuration no longer enables some registers: their states, and channels that no active
 * state needs any more (deepest first).
 *
 * @param all every register of the family
 * @param active the registers that are enabled
 */
export function planCleanup(all: readonly RegisterEntry[], active: readonly RegisterEntry[]): string[] {
    const activeIds = new Set(active.map(r => r.id));
    const neededChannels = new Set(active.flatMap(r => parentChannelIds(stateIdFor(r))));
    const states: string[] = [];
    const channels = new Set<string>();
    for (const reg of all) {
        if (activeIds.has(reg.id)) {
            continue;
        }
        const id = stateIdFor(reg);
        states.push(id);
        parentChannelIds(id)
            .filter(channel => !neededChannels.has(channel))
            .forEach(channel => channels.add(channel));
    }
    const channelList = [...channels].sort((a, b) => b.split('.').length - a.split('.').length);
    return [...states, ...channelList];
}
