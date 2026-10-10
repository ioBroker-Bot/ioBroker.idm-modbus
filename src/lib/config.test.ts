import { expect } from 'chai';
import { readGltSettings, readPlantSettings, readRoomSettings, readStatsSettings } from './config';

describe('readPlantSettings', () => {
    it('uses the spec defaults for an empty configuration', () => {
        const settings = readPlantSettings({});
        expect(settings.family).to.equal('nav20');
        expect(settings.plant.heatingCircuits).to.deep.equal([]);
        expect(settings.plant.zoneModules).to.equal(0);
        expect(settings.intervalsMs).to.deep.equal({ fast: 30000, medium: 60000, slow: 300000, config: 3600000 });
        expect(settings.warnings).to.deep.equal([]);
    });

    it('reads heating circuits, names and blocks', () => {
        const settings = readPlantSettings({
            hcA: true,
            hcC: true,
            hcNameA: ' Ground floor ',
            blockSolar: true,
            blockPv: true,
            zoneModules: 2,
            roomsPerZone: 6,
        });
        expect(settings.plant.heatingCircuits).to.deep.equal(['A', 'C']);
        expect(settings.heatingCircuitNames).to.deep.equal({ A: 'Ground floor' });
        expect(settings.plant.blocks).to.deep.equal({
            solar: true,
            isc: false,
            cascade: false,
            bivalence: false,
            pv: true,
            booster: false,
        });
        expect(settings.plant.zoneModules).to.equal(2);
        expect(settings.plant.roomsPerZone).to.equal(6);
    });

    it('corrects bad entries with a warning and never throws', () => {
        const settings = readPlantSettings({
            family: 'nav99',
            intervalFastS: 2,
            intervalMediumS: 'soon',
            zoneModules: 99,
            roomsPerZone: 'many',
        } as unknown as Partial<ioBroker.AdapterConfig>);
        expect(settings.family).to.equal('nav20');
        expect(settings.intervalsMs.fast).to.equal(30000);
        expect(settings.intervalsMs.medium).to.equal(60000);
        expect(settings.plant.zoneModules).to.equal(10);
        expect(settings.plant.roomsPerZone).to.equal(8);
        expect(settings.warnings).to.have.length(5);
        expect(readPlantSettings({ intervalConfigS: 5 }).intervalsMs.config).to.equal(3600000);
        expect(readPlantSettings({ intervalConfigS: 600 }).intervalsMs.config).to.equal(600000);
    });
});

describe('readStatsSettings', () => {
    it('defaults to statistics on, no external meters, fixed price and the Navigator as heat source', () => {
        const stats = readStatsSettings({});
        expect(stats).to.deep.include({
            enabled: true,
            electricalCounter: null,
            electricalPower: null,
            heatCounter: null,
            heatPower: null,
            thermalSource: 'navigator',
            pricePerKwh: 0.3,
            priceStateId: null,
            co2StateId: null,
            currency: 'EUR',
            co2GramsPerKwh: 350,
            externalMaxAgeMs: 120000,
        });
        expect(stats.warnings).to.deep.equal([]);
    });
    it('reads the external meters of the test installation', () => {
        const stats = readStatsSettings({
            extElecPowerId: 'modbus.2.inputRegisters.30041_Gesamtleistung',
            extElecCounterId: 'modbus.2.inputRegisters.30275_Gesamtbezug',
            extElecPowerUnit: 'W',
        });
        expect(stats.electricalPower).to.deep.equal({ id: 'modbus.2.inputRegisters.30041_Gesamtleistung', unit: 'W' });
        expect(stats.electricalCounter).to.deep.equal({
            id: 'modbus.2.inputRegisters.30275_Gesamtbezug',
            unit: 'auto',
        });
    });
    it('switches off only the broken source and warns', () => {
        const stats = readStatsSettings({
            extElecCounterId: 'not a state id',
            extElecPowerId: 'a.b',
            extElecPowerUnit: 'MW',
            pricePerKwh: -1,
            thermalSource: 'external',
        });
        expect(stats.electricalCounter).to.equal(null);
        expect(stats.electricalPower).to.deep.equal({ id: 'a.b', unit: 'auto' });
        expect(stats.pricePerKwh).to.equal(null);
        expect(stats.thermalSource).to.equal('navigator'); // no heat counter configured
        expect(stats.warnings).to.have.length(4);
    });
});

describe('readGltSettings', () => {
    it('takes the defaults of the function and drops unusable or duplicate rows with a warning', () => {
        const settings = readGltSettings({
            gltEnabled: true,
            gltSources: [
                {
                    function: 'outdoor_temp',
                    stateId: 'a.b',
                    factor: 1,
                    offset: 0,
                    heartbeatS: null,
                    min: null,
                    max: null,
                    maxAgeS: null,
                },
                {
                    function: 'outdoor_temp',
                    stateId: 'c.d',
                    factor: 1,
                    offset: 0,
                    heartbeatS: null,
                    min: null,
                    max: null,
                    maxAgeS: null,
                },
                {
                    function: 'nonsense',
                    stateId: 'x',
                    factor: 1,
                    offset: 0,
                    heartbeatS: null,
                    min: null,
                    max: null,
                    maxAgeS: null,
                },
                {
                    function: 'humidity',
                    stateId: '',
                    factor: 1,
                    offset: 0,
                    heartbeatS: null,
                    min: null,
                    max: null,
                    maxAgeS: null,
                },
                {
                    function: 'demand_dhw',
                    stateId: 'e.f',
                    factor: 0,
                    offset: 0,
                    heartbeatS: null,
                    min: null,
                    max: null,
                    maxAgeS: null,
                },
            ],
        });
        expect(settings.enabled).to.equal(true);
        expect(settings.sources).to.have.length(1);
        expect(settings.sources[0]).to.deep.include({
            registerId: 'ext_outdoor_temp',
            heartbeatMs: 60000,
            min: -50,
            max: 60,
            maxAgeMs: 900000,
        });
        expect(settings.warnings).to.have.length(4);
    });
});

describe('readRoomSettings', () => {
    it('maps a heating circuit to its external room temperature register', () => {
        const settings = readRoomSettings({
            roomsEnabled: true,
            roomSources: [
                {
                    circuit: 'C',
                    stateId: 'a.b',
                    factor: 1,
                    offset: 0,
                    heartbeatS: 300,
                    toleranceC: 0.2,
                    min: 15,
                    max: 30,
                    maxAgeS: 900,
                    onStale: 'stop',
                    fixedValue: null,
                },
            ],
        });
        expect(settings.sources[0].registerId).to.equal('hc_c_ext_room_temp');
    });
});
