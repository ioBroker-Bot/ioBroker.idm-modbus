import type { RegisterEntry } from '../registers/types';

const CIRCUIT_LETTERS = 'ABCDEFG';

/**
 * The IDM tags of the flow and room sensor of a heating circuit: B51 to B57 and B61 to B67 for the circuits A to G (circuit A is
 * B51/B61 in the IDM plant diagram; Xerolux verified the sequence live at a Navigator 10 with circuits A and D).
 *
 * @param letter circuit letter A-G
 */
export function circuitTags(letter: string): { flow: string; room: string } | null {
    const index = CIRCUIT_LETTERS.indexOf(letter);
    return index < 0 ? null : { flow: `B${51 + index}`, room: `B${61 + index}` };
}

/** The IDM tag in a register label, e.g. `Heat storage temperature (B38)`. */
const TAG_IN_LABEL = /\s*\(([BME]\d+v?)\)/;

/**
 * The IDM tag of a measuring point named in a register label.
 *
 * @param label English label of the register
 */
export const idmTag = (label: string): string | undefined => TAG_IN_LABEL.exec(label)?.[1];

/**
 * The register that delivers each IDM tag by Modbus (the register labels carry the tags, the heating circuits' sensors follow the
 * sequence above). The rows of
 * the web interface's input/output tables for a tag are only created where this register has no value.
 *
 * @param registers all registers of the family
 */
export function modbusTagRegisters(registers: readonly RegisterEntry[]): Map<string, string> {
    const byTag = new Map<string, string>();
    for (const letter of CIRCUIT_LETTERS) {
        const tags = circuitTags(letter);
        if (tags) {
            byTag.set(tags.flow, `hc_${letter.toLowerCase()}_flow_temp`);
            byTag.set(tags.room, `hc_${letter.toLowerCase()}_room_temp`);
        }
    }
    for (const reg of registers) {
        const tag = idmTag(reg.label.en);
        if (tag && !byTag.has(tag)) {
            byTag.set(tag, reg.id);
        }
    }
    return byTag;
}
