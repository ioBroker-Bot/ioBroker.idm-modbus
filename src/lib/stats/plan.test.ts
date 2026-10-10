import { expect } from 'chai';
import dictionary from '../dictionary.json';
import { LANGUAGES, type Dictionary, missingLanguages } from '../translations';
import { StatsEngine } from './engine';
import { planStatsObjects, USED_TEXTS } from './plan';

const engine = (external: boolean): StatsEngine =>
    new StatsEngine({
        externalElectricalCounter: external,
        externalElectricalPower: external,
        externalHeatCounter: external,
        externalHeatPower: external,
        thermalSource: 'navigator',
        pricing: true,
        co2GramsPerKwh: 400,
        circuits: ['A', 'B'],
        compressors: 2,
        maxGapMs: () => 180000,
        externalMaxAgeMs: 120000,
        dateKey: ms => new Date(ms).toISOString().slice(0, 10),
    });

describe('statistics state plan', () => {
    for (const external of [false, true]) {
        const label = external ? 'with external meters' : 'internal only';
        const ids = Object.keys(engine(external).outputs(Date.UTC(2026, 2, 10)));

        it(`names every channel and state in all languages (${label})`, () => {
            const planned = planStatsObjects(ids, 'EUR');
            for (const { id, object } of planned) {
                const name = (object.common as { name: Record<string, string> }).name;
                for (const lang of LANGUAGES) {
                    expect(name[lang], `${id} (${lang})`).to.be.a('string').and.not.equal('');
                    expect(name[lang], `${id} (${lang}) has an unfilled placeholder`).to.not.match(/[{}]/);
                }
            }
        });

        it(`creates every parent channel before its states and only states for outputs (${label})`, () => {
            const planned = planStatsObjects(ids, 'EUR');
            const order = planned.map(p => p.id);
            expect(new Set(order).size).to.equal(order.length);
            for (const { id, object } of planned) {
                if (object.type !== 'state') {
                    continue;
                }
                const parts = id.split('.');
                for (let i = 1; i < parts.length; i++) {
                    expect(order.indexOf(parts.slice(0, i).join('.')), `${id} needs its parents`).to.be.within(
                        0,
                        order.indexOf(id) - 1,
                    );
                }
            }
            expect(planned.filter(p => p.object.type === 'state').map(p => p.id)).to.have.members(ids);
        });
    }

    it('uses only English texts that have all translations in the dictionary', () => {
        planStatsObjects(Object.keys(engine(true).outputs(Date.UTC(2026, 2, 10))), 'EUR');
        expect(USED_TEXTS.size).to.be.greaterThan(20);
        const missing = [...USED_TEXTS].filter(key => missingLanguages(key, dictionary as Dictionary).length);
        expect(missing, `missing: ${missing.join(' | ')}`).to.deep.equal([]);
    });

    it('gives energy states kWh and the energy role, costs the configured currency, runtime hours h', () => {
        const planned = planStatsObjects(Object.keys(engine(false).outputs(Date.UTC(2026, 2, 10))), 'CHF');
        const common = (id: string): Record<string, unknown> =>
            planned.find(p => p.id === id)?.object.common as Record<string, unknown>;
        expect(common('stats.energy.thermal.heating.day')).to.include({ unit: 'kWh', role: 'value.energy' });
        expect(common('stats.cost.day')).to.include({ unit: 'CHF' });
        expect(common('stats.runtime.compressor1.hours_day')).to.include({ unit: 'h' });
        expect(common('calc.hp_delta_t')).to.include({ unit: 'K' });
        expect(common('stats.cop.internal.all.rolling365')).to.not.have.property('unit');
    });
});
