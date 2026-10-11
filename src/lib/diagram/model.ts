import { localized, textIn } from '../translations';
import { circuitTags, type SensorInput } from './sensors';

/** What the model needs to know about the installation. */
export interface DiagramInput {
    /** ioBroker system language */
    language: string;
    /** does the state have a real value? (ids relative to the instance) */
    has(id: string): boolean;
    /** the latest value of a state */
    value(id: string): string | number | boolean | null | undefined;
    /** heating circuits enabled in the configuration, with the name the user or the Navigator gave them */
    circuits: { letter: string; name: string | null }[];
    /** ids of all states the adapter has, to find the rooms */
    stateIds: Iterable<string>;
    /** texts of the heat pump operating modes by value, in the user's language */
    hpModes: Record<string, string>;
    /** parts the user switched off in the settings */
    hidden: string[];
    /** the sensors with an IDM tag that the diagram may list */
    sensors?: SensorInput[];
}

/** One more sensor of the plant. */
export interface DiagramSensor extends SensorInput {
    /** where it belongs: heatpump, source, storage, solar, isc or other */
    group: string;
}

/** Group of the sensors by their IDM tag (B35 hot gas line, B43 heat source inlet, ...). */
const SENSOR_GROUPS: Record<string, string> = {
    B2: 'heatpump',
    B35: 'heatpump',
    B45: 'heatpump',
    B36: 'source',
    B37: 'source',
    B43: 'source',
    B46: 'source',
    B72: 'source',
    B40: 'storage',
    B42: 'storage',
    B73: 'solar',
    B74: 'solar',
    B75: 'solar',
    B76: 'solar',
    B44: 'isc',
    B49: 'isc',
};

/** One heating circuit of the diagram. */
export interface DiagramCircuit {
    /** circuit letter A-G */
    letter: string;
    /** name shown in the diagram */
    name: string;
    /** state id of the flow temperature */
    flow: string;
    /** state id of the flow setpoint, if the Navigator has one */
    setpoint: string | null;
    /** state id of the active mode (off, heating, cooling) */
    active: string | null;
    /** state id of the room temperature the circuit reports */
    room: string | null;
    /** IDM tag of its flow sensor, empty where unknown */
    flowTag: string;
    /** IDM tag of its room sensor, empty where unknown */
    roomTag: string;
}

/** One room of the diagram. */
export interface DiagramRoom {
    /** zone module the room belongs to (the page puts the rooms of zone N next to heating circuit N) */
    zone: number;
    /** name shown in the diagram */
    name: string;
    /** state id of the room temperature */
    temperature: string;
    /** state id of the room setpoint, if the room has one */
    target: string | null;
}

/** What the page draws: the parts that exist, the state ids that feed them and the texts. */
export interface DiagramModel {
    /** language of the texts */
    language: string;
    /** where the heat comes from: outside air (fan) or ground/groundwater (heat source sensors and pumps, no air intake) */
    heatSource: 'air' | 'ground';
    /** which parts of the plant exist */
    parts: {
        /** buffer tank (the Navigator reports a storage temperature) */
        buffer: boolean;
        /** hot water heater */
        dhw: boolean;
        /** fresh water station (tapping temperature B42) */
        freshwater: boolean;
        /** photovoltaics values are available */
        pv: boolean;
        /** solar thermal collector */
        solar: boolean;
        /** second or third heat generator */
        bivalence: boolean;
    };
    /** logical name -> state id, `null` where the installation does not have it */
    ids: Record<string, string | null>;
    /** the heating circuits */
    circuits: DiagramCircuit[];
    /** the rooms */
    rooms: DiagramRoom[];
    /** the sensors that are not drawn at a fixed place, with their group */
    sensors: DiagramSensor[];
    /** texts of the heat pump operating modes by value */
    hpModes: Record<string, string>;
    /** texts of the page by name */
    labels: Record<string, string>;
    /** all state ids the page listens to */
    watch: string[];
}

/**
 * The state ids the diagram draws, by logical name, each with the candidates in order of preference. Register ids are the ones
 * `stateIdFor` makes of them (a test checks that they exist); `web.io.*` ids are the keys of `buildIoStates`.
 */
export const DIAGRAM_STATE_IDS: Record<string, string[]> = {
    outdoor: ['system.outdoor_temp'],
    // with a separating heat exchanger the Navigator 10 does not answer 1050/1052 and reports 1068/1070 instead
    hpFlow: ['hp.hp_flow_temp', 'hp.heat_sink_flow_temp'],
    hpReturn: ['hp.hp_return_temp', 'hp.heat_sink_return_temp'],
    hgl: ['hp.hgl_flow_temp'],
    hpMode: ['hp.hp_operating_mode'],
    compressor: ['hp.compressor_status_1'],
    power: ['energy.power_consumption_hp'],
    cop: ['calc.cop_internal'],
    buffer: ['dhw.storage_temp', 'hp.storage_temp'],
    dhwTop: ['dhw.dhw_temp_top', 'dhw.dhw_temp'],
    dhwBottom: ['dhw.dhw_temp_bottom'],
    dhwSetpoint: ['dhw.dhw_setpoint'],
    dhwTap: ['dhw.dhw_tapping_temp'],
    pvProduction: ['pv.pv_production'],
    pvHouse: ['pv.house_consumption'],
    pvSurplus: ['pv.pv_surplus'],
    pvBattery: ['pv.battery_soc'],
    pvBatteryPower: ['pv.battery_discharge'],
    solarCollector: ['solar.solar_collector_temp'],
    bivalence: ['bivalence.bivalence_state'],
    pumpBrine: ['hp.brine_pump_status'],
    pumpSource: ['hp.heat_source_pump_status'],
    dhwFlow: ['web.io.digital_in.b1'],
    pumpM22: ['web.io.analog_out.m22'],
    pumpM73: ['hp.charging_pump_status', 'web.io.analog_out.m73'],
    pumpM31: ['web.io.digital_out.m31'],
    fanM13: ['web.io.analog_out.m13'],
};

/** States that tell where the heat comes from: an air intake means an air heat pump, source sensors and pumps a ground one. */
const AIR_INTAKE_ID = 'hp.air_intake_temp';
const GROUND_SOURCE_IDS = ['hp.heat_source_inlet_temp', 'hp.heat_source_outlet_temp'];

/** Texts of the page (English keys of the dictionary). */
const LABELS: Record<string, string> = {
    title: 'Heat pump diagram',
    outdoor: 'Outdoor',
    flow: 'Flow',
    power: 'Power',
    cop: 'COP',
    heatPump: 'Heat pump',
    buffer: 'Buffer',
    dhw: 'Hot water',
    setpoint: 'Setpoint',
    pv: 'Photovoltaics',
    house: 'House',
    surplus: 'Surplus',
    battery: 'Battery',
    solar: 'Solar thermal',
    collector: 'Collector',
    bivalence: 'Bivalence',
    rooms: 'Rooms',
    room: 'Room',
    storage: 'Storage',
    isc: 'ISC',
    other: 'Sensors',
    on: 'On',
    off: 'Off',
    freshwater: 'Fresh water station',
    coldWater: 'Cold water',
    connected: 'Connected',
    disconnected: 'Not connected',
    updated: 'Updated',
};

const nonNull = (ids: (string | null)[]): string[] => ids.filter((id): id is string => id !== null);

/**
 * Work out which parts of the diagram exist for this installation, from the states that have real values (so hardware the
 * plant does not have never shows up) and from the settings.
 *
 * @param input what the adapter knows
 */
export function buildDiagramModel(input: DiagramInput): DiagramModel {
    const pick = (candidates: string[]): string | null => candidates.find(id => input.has(id)) ?? null;
    const show = (part: string): boolean => !input.hidden.includes(part);
    const ids: Record<string, string | null> = { connection: 'info.connection' };
    for (const [name, candidates] of Object.entries(DIAGRAM_STATE_IDS)) {
        ids[name] = pick(candidates);
    }

    const circuits: DiagramCircuit[] = [];
    for (const { letter, name } of input.circuits) {
        const flow = pick([`hc.${letter}.flow_temp`]);
        if (flow) {
            const tags = circuitTags(letter);
            circuits.push({
                letter,
                name: name ?? textIn(localized('Heating circuit {i}', { i: letter }), input.language),
                flow,
                setpoint: pick([`hc.${letter}.setpoint_flow_temp`]),
                active: pick([`hc.${letter}.active_mode`]),
                room: pick([`hc.${letter}.room_temp`]),
                flowTag: tags?.flow ?? '',
                roomTag: tags?.room ?? '',
            });
        }
    }

    const rooms: DiagramRoom[] = [];
    for (const id of input.stateIds) {
        const match = /^zones\.(\d+)\.rooms\.(\d+)\.temp$/.exec(id);
        if (match && input.has(id)) {
            const zone = Number(match[1]);
            const room = Number(match[2]);
            const setpoint = `zones.${zone}.rooms.${room}.setpoint`;
            const name = input.value(`zones.${zone}.rooms.${room}.name`);
            rooms.push({
                zone,
                name: typeof name === 'string' && name ? name : `${zone}.${room}`,
                temperature: id,
                target: input.has(setpoint) ? setpoint : null,
            });
        }
    }
    rooms.sort((a, b) => a.name.localeCompare(b.name));

    const drawn = new Set(nonNull(Object.values(ids)));
    const sensors: DiagramSensor[] = (input.sensors ?? [])
        .filter(sensor => input.has(sensor.id) && !drawn.has(sensor.id))
        .map(sensor => ({ ...sensor, group: SENSOR_GROUPS[sensor.tag] ?? 'other' }))
        .sort((a, b) => parseInt(a.tag.slice(1), 10) - parseInt(b.tag.slice(1), 10) || a.tag.localeCompare(b.tag));

    const ground =
        !input.has(AIR_INTAKE_ID) &&
        (GROUND_SOURCE_IDS.some(id => input.has(id)) || ids.pumpBrine !== null || ids.pumpSource !== null);
    const watch = [
        ...nonNull(Object.values(ids)),
        ...circuits.flatMap(c => nonNull([c.flow, c.setpoint, c.active, c.room])),
        ...rooms.flatMap(r => nonNull([r.temperature, r.target])),
        ...sensors.map(sensor => sensor.id),
    ];
    return {
        language: input.language,
        heatSource: ground ? 'ground' : 'air',
        parts: {
            buffer: ids.buffer !== null && show('buffer'),
            dhw: ids.dhwTop !== null && show('dhw'),
            freshwater: ids.dhwTap !== null && show('dhw'),
            pv: (ids.pvProduction !== null || ids.pvSurplus !== null) && show('pv'),
            solar: ids.solarCollector !== null && show('solar'),
            bivalence: ids.bivalence !== null && show('bivalence'),
        },
        ids,
        circuits,
        rooms,
        sensors,
        hpModes: input.hpModes,
        labels: Object.fromEntries(
            Object.entries(LABELS).map(([key, text]) => [key, textIn(localized(text), input.language)]),
        ),
        watch: [...new Set(watch)],
    };
}

/** English texts the model uses, for the translation test. */
export const DIAGRAM_TEXTS: readonly string[] = [...Object.values(LABELS), 'Heating circuit {i}'];
