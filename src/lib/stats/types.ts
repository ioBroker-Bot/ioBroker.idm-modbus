/** Operating mode of the heat pump as reported by register 1090 (spec Modul G: energy is attributed to it). */
export const MODES = ['heating', 'dhw', 'cooling', 'defrost', 'off'] as const;
/** One operating mode. */
export type Mode = (typeof MODES)[number];
/** Modes that produce heat and have a thermal counter in the Navigator. */
export const THERMAL_MODES = ['heating', 'dhw', 'cooling', 'defrost'] as const;
/** One mode with a thermal counter. */
export type ThermalMode = (typeof THERMAL_MODES)[number];
/** Energy per operating mode in kWh. */
export type ModeEnergy = Record<Mode, number>;
/** The two electrical sources: the Navigator's own power register and an external meter. */
export type ElectricalSource = 'internal' | 'external';

/** Energy sums of one period. */
export interface Bucket {
    /** electrical energy from the Navigator's power register (integrated), by operating mode */
    elecInternal: ModeEnergy;
    /** electrical energy from the external meter, by operating mode */
    elecExternal: ModeEnergy;
    /** thermal energy from the Navigator's heat counters, by mode */
    thermal: Record<ThermalMode, number>;
    /** thermal energy from an external heat meter (all modes together) */
    thermalExternal: number;
    /** thermal power register of the Navigator, integrated; only for comparing it with the heat counters */
    thermalIntegrated: number;
    /** electricity cost in the configured currency, accrued at the price valid when the energy was used */
    cost: number;
    /** CO₂ in kg, accrued at the intensity valid when the energy was used */
    co2: number;
}

/** A calendar day of energy sums. */
export interface DayBucket extends Bucket {
    /** local date, `YYYY-MM-DD` */
    date: string;
}

/**
 * Map the Navigator's operating mode register to a mode.
 *
 * @param value register 1090 (0 off, 1 heating, 2 cooling, 4 hot water, 8 defrost)
 */
export function modeFromRegister(value: number | null): Mode {
    switch (value) {
        case 1:
            return 'heating';
        case 2:
            return 'cooling';
        case 4:
            return 'dhw';
        case 8:
            return 'defrost';
        default:
            return 'off';
    }
}

/** A mode record with every mode at zero. */
export function emptyModeEnergy(): ModeEnergy {
    return { heating: 0, dhw: 0, cooling: 0, defrost: 0, off: 0 };
}

/** A bucket with everything at zero. */
export function emptyBucket(): Bucket {
    return {
        elecInternal: emptyModeEnergy(),
        elecExternal: emptyModeEnergy(),
        thermal: { heating: 0, dhw: 0, cooling: 0, defrost: 0 },
        thermalExternal: 0,
        thermalIntegrated: 0,
        cost: 0,
        co2: 0,
    };
}

/**
 * Sum of all modes of a mode record.
 *
 * @param energy per-mode energy
 */
export function sumModes(energy: ModeEnergy): number {
    return MODES.reduce((sum, mode) => sum + energy[mode], 0);
}
