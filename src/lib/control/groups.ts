import type { ControlSettings } from '../config';
import type { RegisterEntry } from '../registers/types';

/** Register that acknowledges fault messages; write-only, so it has no polled state (spec Modul B "Quittieren"). */
export const ACKNOWLEDGE_ID = 'error_acknowledge';

/**
 * May the user write this register, given the write switches? Only settings (access RW) of the groups the user has enabled,
 * plus the fault acknowledgement button. Zone modules contribute only the setpoint and operating mode of each room. Everything
 * else - sensors, the GLT inputs, room temperature and humidity - is not part of the control module.
 *
 * @param reg a register
 * @param control the control settings
 */
export function isWritable(reg: RegisterEntry, control: ControlSettings): boolean {
    if (reg.id === ACKNOWLEDGE_ID) {
        return control.system;
    }
    if (reg.access !== 'RW') {
        return false;
    }
    switch (reg.group) {
        case 'system':
            return control.system;
        case 'dhw':
            return control.dhw;
        case 'hc':
            return reg.instance !== null && control.heatingCircuits.includes(reg.instance);
        case 'zones':
            // only the setpoint and operating mode of a room; its temperature and humidity are sensor values (Modul C)
            return control.zones && /_(setpoint|mode)$/.test(reg.id) && reg.room !== null;
        case 'bivalence':
        case 'cascade':
            return control.expert;
        case 'solar':
            return control.solar;
        default:
            return false;
    }
}
