import type { FloatWordOrder } from '../constants';
import type { RegisterType } from '../registers/types';
import { fail, ok, type Result } from './result';

/**
 * Decode raw 16-bit register words into a number.
 *
 * FLOAT is IEEE 754 over two registers; the IDM document (chapter 4.2) sends Reg_L first, which is `lowFirst`
 * (spec O1, confirmed at the device in Step 5).
 *
 * @param type register type from the register file
 * @param words raw words, exactly 2 for FLOAT, otherwise 1
 * @param order FLOAT word order
 * @returns the value, or `null` when the word count does not match the type or a FLOAT is NaN/infinite
 */
export function decodeWords(type: RegisterType, words: readonly number[], order: FloatWordOrder): number | null {
    if (type === 'FLOAT') {
        if (words.length !== 2) {
            return null;
        }
        const buf = Buffer.alloc(4);
        const [first, second] = words;
        const high = order === 'lowFirst' ? second : first;
        const low = order === 'lowFirst' ? first : second;
        buf.writeUInt16BE(high & 0xffff, 0);
        buf.writeUInt16BE(low & 0xffff, 2);
        const value = buf.readFloatBE(0);
        return Number.isFinite(value) ? value : null;
    }
    if (words.length !== 1) {
        return null;
    }
    const word = words[0] & 0xffff;
    return type === 'INT16' ? (word > 0x7fff ? word - 0x10000 : word) : word;
}

/**
 * Encode a value into raw register words, validating it against the type (not against min/max - that is the write guard).
 *
 * @param type register type
 * @param value value to encode
 * @param order FLOAT word order
 */
export function encodeValue(type: RegisterType, value: number, order: FloatWordOrder): Result<number[]> {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fail('invalid', 'Value is not a finite number');
    }
    if (type === 'FLOAT') {
        const buf = Buffer.alloc(4);
        buf.writeFloatBE(value, 0);
        const high = buf.readUInt16BE(0);
        const low = buf.readUInt16BE(2);
        return ok(order === 'lowFirst' ? [low, high] : [high, low]);
    }
    if (!Number.isInteger(value)) {
        return fail('invalid', `${type} needs an integer`);
    }
    const range: Record<Exclude<RegisterType, 'FLOAT'>, [number, number]> = {
        BOOL: [0, 1],
        UCHAR: [0, 255],
        UINT16: [0, 65535],
        INT16: [-32768, 32767],
    };
    const [min, max] = range[type];
    if (value < min || value > max) {
        return fail('invalid', `${type} value out of range ${min}..${max}`);
    }
    return ok([value & 0xffff]);
}
