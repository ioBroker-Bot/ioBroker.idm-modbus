import type { RegisterEntry } from '../registers/types';
import { stateIdFor } from '../state-model';
import { textIn } from '../translations';
import type { WebSensor } from '../web/io';

/** A temperature (or other) sensor of the plant that the diagram may show. */
export interface SensorInput {
    /** state id */
    id: string;
    /** IDM tag of the measuring point, e.g. B43 */
    tag: string;
    /** name in the user's language */
    name: string;
    /** unit (°C, bar, l/min, V) */
    unit: string;
}

/** Flow and room sensor of heating circuit A in the IDM plant diagram; the Navigator's sensor table names the other circuits'. */
export const CIRCUIT_A_TAGS = { flow: 'B51', room: 'B61' } as const;

/** Sensors of the web interface that the diagram shows (the heating flow rate); the others exist as states only. */
const DIAGRAM_WEB_SENSOR_TAGS: ReadonlySet<string> = new Set(['B2']);

/** The IDM tag in a register label, e.g. `Heat storage temperature (B38)`. */
const TAG_IN_LABEL = /\s*\(([BME]\d+v?)\)/;

/**
 * The IDM tag of a measuring point named in a register label.
 *
 * @param label English label of the register
 */
export const idmTag = (label: string): string | undefined => TAG_IN_LABEL.exec(label)?.[1];

/**
 * Every temperature of the registers that carries an IDM tag, with its name in the user's language (the tag is cut from it).
 *
 * @param registers all registers of the family
 * @param language ioBroker system language
 */
export function registerSensors(registers: readonly RegisterEntry[], language: string | undefined): SensorInput[] {
    return registers.flatMap(reg => {
        const tag = idmTag(reg.label.en);
        return tag && reg.unit === '°C' && reg.access !== 'W'
            ? [
                  {
                      id: stateIdFor(reg),
                      tag,
                      name: textIn(reg.label, language).replace(TAG_IN_LABEL, ''),
                      unit: reg.unit,
                  },
              ]
            : [];
    });
}

/**
 * The register that delivers each IDM tag by Modbus (the register labels carry the tags), plus the flow of circuit A. The rows of
 * the web interface's input/output tables for a tag are only created where this register has no value.
 *
 * @param registers all registers of the family
 */
export function modbusTagRegisters(registers: readonly RegisterEntry[]): Map<string, string> {
    const byTag = new Map<string, string>([[CIRCUIT_A_TAGS.flow, 'hc_a_flow_temp']]);
    for (const reg of registers) {
        const tag = idmTag(reg.label.en);
        if (tag && !byTag.has(tag)) {
            byTag.set(tag, reg.id);
        }
    }
    return byTag;
}

/**
 * The web sensors the diagram shows, with their names in the user's language.
 *
 * @param sensors sensors of the web interface
 * @param language ioBroker system language
 */
export function diagramWebSensors(sensors: readonly WebSensor[], language: string | undefined): SensorInput[] {
    return sensors
        .filter(sensor => DIAGRAM_WEB_SENSOR_TAGS.has(sensor.tag))
        .map(sensor => ({
            ...sensor,
            name: typeof sensor.name === 'string' ? sensor.name : textIn(sensor.name, language),
        }));
}
