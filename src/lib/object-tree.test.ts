import { expect } from 'chai';
import { planCleanup, planObjects } from './object-tree';
import { activeRegisters, loadRegisters, type PlantConfig } from './registers/plant';
import type { RegisterEntry } from './registers/types';

const nav20 = loadRegisters('nav20') as RegisterEntry[];
const plant: PlantConfig = {
    heatingCircuits: ['A', 'B'],
    zoneModules: 2,
    roomsPerZone: 3,
    blocks: { solar: true, isc: false, cascade: false, bivalence: true, pv: true, booster: false },
};

describe('planObjects', () => {
    const planned = planObjects(activeRegisters(nav20, plant), { A: 'Ground floor' });
    const ids = planned.map(p => p.id);

    it('creates every parent channel before its children, no orphans', () => {
        for (const [index, p] of planned.entries()) {
            if (p.object.type !== 'state') {
                continue;
            }
            const parts = p.id.split('.');
            for (let i = 1; i < parts.length; i++) {
                const parent = parts.slice(0, i).join('.');
                expect(ids.indexOf(parent), `${p.id} needs ${parent}`).to.be.within(0, index - 1);
            }
        }
        expect(new Set(ids).size).to.equal(ids.length);
    });

    it('names channels, using the configured heating circuit names', () => {
        const names = Object.fromEntries(
            planned.map(p => [p.id, (p.object.common as { name?: unknown } | undefined)?.name]),
        );
        expect(names['hc.A']).to.equal('Ground floor');
        expect(names['hc.B']).to.include({ en: 'Heating circuit B', de: 'Heizkreis B' });
        expect(names['zones.2.rooms.3']).to.include({ en: 'Room 3', de: 'Raum 3' });
        expect(planned.find(p => p.id === 'hp')?.object.type).to.equal('channel');
    });

    it('creates only what the plant enables', () => {
        expect(ids).to.include('hc.A.flow_temp');
        expect(ids).to.not.include('hc.C.flow_temp');
        expect(ids).to.include('zones.2.rooms.3.temp');
        expect(ids).to.not.include('zones.2.rooms.4.temp');
        expect(ids).to.not.include('zones.3');
        expect(ids).to.not.include('cascade');
    });

    it('stores the Modbus address in native for diagnostics', () => {
        const state = planned.find(p => p.id === 'system.outdoor_temp');
        expect(state?.object.native).to.deep.equal({ address: 1000 });
    });
});

describe('planCleanup', () => {
    it('removes states of disabled registers and channels nothing needs any more, deepest first', () => {
        const before = activeRegisters(nav20, plant);
        const after = activeRegisters(nav20, {
            ...plant,
            heatingCircuits: ['A'],
            blocks: { ...plant.blocks, solar: false },
        });
        const removed = planCleanup(before, after);
        expect(removed).to.include('hc.B.flow_temp');
        expect(removed).to.include('hc.B');
        expect(removed).to.not.include('hc.A');
        expect(removed).to.not.include('hc');
        expect(removed).to.include('solar');
        expect(removed.indexOf('hc.B.flow_temp')).to.be.lessThan(removed.indexOf('hc.B'));
    });
});
