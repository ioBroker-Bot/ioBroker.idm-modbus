import type { FloatWordOrder } from '../constants';
import { encodeValue } from '../modbus/codec';
import type { RegisterEntry } from '../registers/types';

/** Why a write was refused before anything reached the device. */
export type WriteRefusal =
    'not-writable' | 'not-a-number' | 'type' | 'range' | 'not-allowed-value' | 'order' | 'unknown-register';

/** Result of checking a requested value. */
export type WriteCheck =
    | {
          ok: true;
          /** the value as the register holds it (booleans become 0/1, values are rounded to the register's step) */
          value: number;
          /** raw 16-bit words to write */
          words: number[];
      }
    | {
          ok: false;
          reason: WriteRefusal;
          /** English message for the log, no host or credentials */
          message: string;
      };

/** Current values of other registers, needed for rules that relate two settings. */
export interface WriteContext {
    /** latest known value of a register of the family, `undefined` when unknown */
    current(registerId: string): number | undefined;
    /** FLOAT word order */
    floatWordOrder: FloatWordOrder;
}

/**
 * Turn a state value into a number: numbers as they are, booleans to 0/1, numeric strings parsed.
 *
 * @param raw the value of the state
 */
export function toNumber(raw: unknown): number | null {
    if (typeof raw === 'boolean') {
        return raw ? 1 : 0;
    }
    if (typeof raw === 'number') {
        return Number.isFinite(raw) ? raw : null;
    }
    if (typeof raw === 'string' && raw.trim() !== '') {
        const parsed = Number(raw.replace(',', '.'));
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

/**
 * Settings that must keep an order to each other. The IDM document gives the ranges, the relation is our own protection
 * against inputs the Navigator would either reject or act on strangely (spec Modul B).
 */
const ORDERED_PAIRS: { low: string; high: string }[] = [{ low: 'dhw_charge_on_temp', high: 'dhw_charge_off_temp' }];

/**
 * Check a requested value against everything the register file knows: access, type, range, allowed enum values and the
 * order between related settings. Nothing is sent to the device here.
 *
 * @param reg the register
 * @param raw the requested value
 * @param context values of related registers and the FLOAT word order
 */
export function checkWrite(reg: RegisterEntry | undefined, raw: unknown, context: WriteContext): WriteCheck {
    if (!reg) {
        return { ok: false, reason: 'unknown-register', message: 'Unknown register' };
    }
    if (reg.access === 'R') {
        return { ok: false, reason: 'not-writable', message: `${reg.id} is read-only` };
    }
    const requested = toNumber(raw);
    if (requested === null) {
        return { ok: false, reason: 'not-a-number', message: `${reg.id}: the value is not a number` };
    }
    // Some registers only take multiples of a step (room setpoints: 0.5 °C, spec Modul C); round to the nearest one.
    const value = reg.step ? Math.round(Math.round(requested / reg.step) * reg.step * 1e6) / 1e6 : requested;
    if (reg.enum) {
        if (!Object.prototype.hasOwnProperty.call(reg.enum, String(value))) {
            return {
                ok: false,
                reason: 'not-allowed-value',
                message: `${reg.id}: ${value} is not one of the allowed values (${Object.keys(reg.enum).join(', ')})`,
            };
        }
    } else if ((reg.min !== null && value < reg.min) || (reg.max !== null && value > reg.max)) {
        return {
            ok: false,
            reason: 'range',
            message: `${reg.id}: ${value} is outside the allowed range ${reg.min ?? '-'} to ${reg.max ?? '-'}`,
        };
    }
    for (const pair of ORDERED_PAIRS) {
        if (reg.id === pair.low) {
            const other = context.current(pair.high);
            if (other !== undefined && value >= other) {
                return {
                    ok: false,
                    reason: 'order',
                    message: `${reg.id} (${value}) must stay below ${pair.high} (${other})`,
                };
            }
        } else if (reg.id === pair.high) {
            const other = context.current(pair.low);
            if (other !== undefined && value <= other) {
                return {
                    ok: false,
                    reason: 'order',
                    message: `${reg.id} (${value}) must stay above ${pair.low} (${other})`,
                };
            }
        }
    }
    const encoded = encodeValue(reg.type, value, context.floatWordOrder);
    if (!encoded.ok) {
        return { ok: false, reason: 'type', message: `${reg.id}: ${encoded.error.message}` };
    }
    return { ok: true, value, words: encoded.value };
}
