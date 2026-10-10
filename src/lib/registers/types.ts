import type { LocalizedText } from '../translations';

/** Wire/decoded type of a register (spec "Register-Modell"). PDF `WORD` is carried as INT16. */
export type RegisterType = 'FLOAT' | 'UCHAR' | 'BOOL' | 'INT16' | 'UINT16';

/** Polling group of a register (spec Modul A); `null` = never polled (write-only). */
export type PollGroup = 'fast' | 'medium' | 'slow' | 'config';

/** A fully expanded register as written to `src/lib/registers/<family>.json` by `tools/build-registers.ts`. */
export interface RegisterEntry {
    id: string;
    address: number;
    /** Number of 16-bit registers (FLOAT = 2). */
    words: number;
    type: RegisterType;
    pdfType: string;
    access: 'R' | 'RW' | 'W';
    /** PDF access `RW/RO`: writable with external sensors, read-only with IDM sensors. */
    idmSensorRo: boolean;
    unit: string | null;
    group: string;
    instance: string | null;
    room: string | null;
    poll: PollGroup | null;
    min: number | null;
    max: number | null;
    default: number | null;
    /** Navigator 1.x firmware: the byte arrives in both bytes of the word; decode the low byte (`0xFFFF` stays "not available"). */
    lowByte?: boolean;
    eeprom: boolean;
    /** treated like an EEPROM register when writing (minimum interval, skip if equal) although the PDF does not star it */
    rateLimited: boolean;
    /** write granularity: requested values are rounded to a multiple of it (room setpoints: 0.5), `null` = none */
    step: number | null;
    /** `min`/`max` are our own protective range, not taken from the IDM document */
    ownRange: boolean;
    cyclicSec: number | null;
    sentinel: number[];
    enum: Record<string, LocalizedText> | null;
    requires: string[];
    /** IDs of registers whose address range intersects this one (PDF address overlaps, see spec). */
    overlaps: string[];
    verified: 'doc' | 'community' | 'device';
    /** how the register behaved at the test device (scan): answered with a plausible value, answered "not available", or does not exist; `null` = not scanned */
    deviceStatus: 'present' | 'unavailable' | 'absent' | null;
    /** function codes that answered at the test device (`[]` when none) */
    deviceFc: (3 | 4)[] | null;
    typeSource: 'doc' | 'community' | 'device';
    note: string | null;
    label: LocalizedText;
}
