import type { RegisterEntry } from '../registers/types';
import { textIn } from '../translations';
import type { WebSensor } from '../web/io';
import type { ValueHub } from './hub';
import { buildDiagramModel, type DiagramModel } from './model';
import { diagramWebSensors, registerSensors } from './sensors';

/** What the adapter hands over to build the model of the diagram. */
export interface ModelSourceOptions {
    /** all registers of the family */
    registers: readonly RegisterEntry[];
    /** ioBroker system language */
    language: string | undefined;
    /** enabled heating circuit letters */
    circuits: string[];
    /** names the user gave the heating circuits */
    circuitNames: Record<string, string>;
    /** parts the user switched off */
    hidden: string[];
    /** the latest values */
    hub: ValueHub;
    /** the sensors the web interface reported so far */
    webSensors(): WebSensor[];
}

/**
 * The function that builds the current model of the diagram. Everything that does not change while the adapter runs (the sensors
 * of the registers, the operating mode texts) is worked out once.
 *
 * @param options what the adapter knows
 */
export function createModelSource(options: ModelSourceOptions): () => DiagramModel {
    const { registers, language, hub } = options;
    const registerList = registerSensors(registers, language);
    const hpModes = Object.fromEntries(
        Object.entries(registers.find(reg => reg.id === 'hp_operating_mode')?.enum ?? {}).map(([value, text]) => [
            value,
            textIn(text, language),
        ]),
    );
    return () => {
        return buildDiagramModel({
            language: language ?? 'en',
            has: id => hub.has(id),
            value: id => hub.get(id),
            circuits: options.circuits.map(letter => ({ letter, name: options.circuitNames[letter] ?? null })),
            stateIds: hub.ids(),
            hpModes,
            hidden: options.hidden,
            sensors: [...registerList, ...diagramWebSensors(options.webSensors(), language)],
        });
    };
}
