import { localized, textIn } from '../translations';

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
    /** texts of the heat pump operating modes and of the heating circuit modes, by value, in the user's language */
    enums: { hpMode: Record<string, string>; hcActive: Record<string, string> };
    /** parts the user switched off in the settings */
    hidden: string[];
    /** every temperature sensor of the Navigator with its IDM sensor tag (B33, B48, ...), name in the user's language */
    sensors?: { id: string; tag: string; name: string }[];
}

/** One more temperature sensor of the plant. */
export interface DiagramSensor {
    /** state id */
    id: string;
    /** sensor tag of the IDM plant diagrams, e.g. B43 */
    tag: string;
    /** name in the user's language */
    name: string;
    /** where it belongs: heat pump, heat source, storage, solar, isc or other */
    group: string;
}

/** Group of the sensors by their tag in the plant diagrams of IDM (B35 hot gas line, B43 heat source inlet, ...). */
const SENSOR_GROUPS: Record<string, string> = {
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
}

/** One room of the diagram. */
export interface DiagramRoom {
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
        /** cascade of several heat pumps */
        cascade: boolean;
        /** ISC (waste heat use) */
        isc: boolean;
        /** booster heat pumps (Navigator 10) */
        booster: boolean;
    };
    /** logical name -> state id, `null` where the installation does not have it */
    ids: Record<string, string | null>;
    /** the heating circuits */
    circuits: DiagramCircuit[];
    /** the rooms */
    rooms: DiagramRoom[];
    /** the other temperature sensors that report a value */
    sensors: DiagramSensor[];
    /** texts of the operating modes */
    enums: DiagramInput['enums'];
    /** texts of the page by name */
    labels: Record<string, string>;
    /** all state ids the page listens to */
    watch: string[];
}

/** Texts of the page (English keys of the dictionary). */
const LABELS: Record<string, string> = {
    title: 'Heat pump diagram',
    outdoor: 'Outdoor',
    flow: 'Flow',
    return: 'Return',
    power: 'Power',
    cop: 'COP',
    heatPump: 'Heat pump',
    buffer: 'Buffer',
    dhw: 'Hot water',
    setpoint: 'Setpoint',
    top: 'Top',
    bottom: 'Bottom',
    pv: 'Photovoltaics',
    production: 'Production',
    house: 'House',
    surplus: 'Surplus',
    battery: 'Battery',
    solar: 'Solar thermal',
    collector: 'Collector',
    bivalence: 'Bivalence',
    rooms: 'Rooms',
    room: 'Room',
    source: 'Heat source',
    storage: 'Storage',
    isc: 'ISC',
    other: 'Sensors',
    hgl: 'Hot gas line',
    freshwater: 'Fresh water station',
    coldWater: 'Cold water',
    connected: 'Connected',
    disconnected: 'Not connected',
    updated: 'Updated',
};

/**
 * The first of the candidate state ids that has a value, else `null`.
 *
 * @param input what the adapter knows
 * @param candidates state ids in order of preference
 */
const pick = (input: DiagramInput, candidates: string[]): string | null => candidates.find(id => input.has(id)) ?? null;

/**
 * Work out which parts of the diagram exist for this installation, from the states that have real values (so hardware the
 * plant does not have never shows up) and from the settings.
 *
 * @param input what the adapter knows
 */
export function buildDiagramModel(input: DiagramInput): DiagramModel {
    const show = (part: string): boolean => !input.hidden.includes(part);
    const ids: Record<string, string | null> = {
        connection: 'info.connection',
        outdoor: pick(input, ['system.outdoor_temp']),
        hpFlow: pick(input, ['hp.hp_flow_temp']),
        hpReturn: pick(input, ['hp.hp_return_temp']),
        hgl: pick(input, ['hp.hgl_flow_temp']),
        dhwTap: pick(input, ['dhw.dhw_tapping_temp']),
        hpMode: pick(input, ['hp.hp_operating_mode']),
        compressor: pick(input, ['hp.compressor_status_1']),
        power: pick(input, ['energy.power_consumption_hp']),
        cop: pick(input, ['calc.cop_internal']),
        buffer: pick(input, ['dhw.storage_temp', 'hp.storage_temp']),
        dhwTop: pick(input, ['dhw.dhw_temp_top', 'dhw.dhw_temp']),
        dhwBottom: pick(input, ['dhw.dhw_temp_bottom']),
        dhwSetpoint: pick(input, ['dhw.dhw_setpoint']),
        pvProduction: pick(input, ['pv.pv_production']),
        pvHouse: pick(input, ['pv.house_consumption']),
        pvSurplus: pick(input, ['pv.pv_surplus']),
        pvBattery: pick(input, ['pv.battery_soc']),
        pvBatteryPower: pick(input, ['pv.battery_discharge']),
        solarCollector: pick(input, ['solar.solar_collector_temp']),
        bivalence: pick(input, ['bivalence.bivalence_state']),
    };
    const circuits: DiagramCircuit[] = [];
    for (const circuit of input.circuits) {
        const flow = pick(input, [`hc.${circuit.letter}.flow_temp`]);
        if (flow) {
            circuits.push({
                letter: circuit.letter,
                name: circuit.name ?? textIn(localized('Heating circuit {i}', { i: circuit.letter }), input.language),
                flow,
                setpoint: pick(input, [`hc.${circuit.letter}.setpoint_flow_temp`]),
                active: pick(input, [`hc.${circuit.letter}.active_mode`]),
                room: pick(input, [`hc.${circuit.letter}.room_temp`]),
            });
        }
    }
    const rooms: DiagramRoom[] = [];
    for (const id of input.stateIds) {
        const match = /^zones\.(\d+)\.rooms\.(\d+)\.temp$/.exec(id);
        if (match && input.has(id)) {
            const zone = Number(match[1]);
            const room = Number(match[2]);
            const webName = input.value(`web.rooms.${zone * 100 + room}.name`);
            rooms.push({
                name: typeof webName === 'string' && webName ? webName : `${zone}.${room}`,
                temperature: id,
                target: input.has(`zones.${zone}.rooms.${room}.setpoint`)
                    ? `zones.${zone}.rooms.${room}.setpoint`
                    : null,
            });
        }
    }
    const used = new Set(Object.values(ids).filter((id): id is string => id !== null));
    const sensors: DiagramSensor[] = (input.sensors ?? [])
        .filter(sensor => input.has(sensor.id) && !used.has(sensor.id))
        .map(sensor => ({ ...sensor, group: SENSOR_GROUPS[sensor.tag] ?? 'other' }))
        .sort((a, b) => Number(a.tag.slice(1)) - Number(b.tag.slice(1)));
    const parts = {
        buffer: ids.buffer !== null && show('buffer'),
        dhw: ids.dhwTop !== null && show('dhw'),
        freshwater: ids.dhwTap !== null && show('dhw'),
        pv: (ids.pvProduction !== null || ids.pvSurplus !== null) && show('pv'),
        solar: ids.solarCollector !== null && show('solar'),
        bivalence: ids.bivalence !== null && show('bivalence'),
        cascade: input.has('cascade.cascade_available_heating') && show('cascade'),
        isc: input.has('isc.isc_mode') && show('isc'),
        booster: input.has('booster.booster_fault') && show('booster'),
    };
    const labels = Object.fromEntries(
        Object.entries(LABELS).map(([key, text]) => [key, textIn(localized(text), input.language)]),
    );
    const watch = [
        ...Object.values(ids).filter((id): id is string => id !== null),
        ...circuits.flatMap(c => [c.flow, c.setpoint, c.active, c.room].filter((id): id is string => id !== null)),
        ...sensors.map(sensor => sensor.id),
        ...rooms.flatMap(r => [r.temperature, r.target].filter((id): id is string => id !== null)),
    ];
    return {
        language: input.language,
        parts,
        ids: Object.fromEntries(Object.entries(ids).map(([key, id]) => [key, id])),
        circuits,
        sensors,
        rooms: rooms.sort((a, b) => a.name.localeCompare(b.name)),
        enums: input.enums,
        labels,
        watch: [...new Set(watch)],
    };
}

/** English texts the model uses, for the translation test. */
export const DIAGRAM_TEXTS: readonly string[] = [...Object.values(LABELS), 'Heating circuit {i}'];
