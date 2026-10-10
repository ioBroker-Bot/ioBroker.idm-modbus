import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildFaultMessages } from '../../tools/build-faults';
import dictionary from './dictionary.json';
import faults from './fault-messages.json';
import { faultText } from './faults';
import { LANGUAGES, missingLanguages, type Dictionary } from './translations';

const source = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'sources', 'nav20.faults.source.json'), 'utf8'),
) as Parameters<typeof buildFaultMessages>[0];

describe('fault texts', () => {
    it('is up to date with the source file (run npm run build:faults)', () => {
        expect(faults.messages).to.deep.equal(buildFaultMessages(source));
    });

    it('has every text in all 11 languages', () => {
        const texts = new Set<string>(['Fault {code}', 'Fault {code} (unknown)']);
        Object.values(faults.messages).forEach(m => {
            texts.add(m.text);
            if ('sensor' in m && m.sensor) {
                texts.add(m.sensor);
            }
        });
        const missing = [...texts].filter(t => missingLanguages(t, dictionary as Dictionary).length);
        expect(missing).to.deep.equal([]);
    });

    it('turns numbers into texts: sensor pairs, plant faults, events, unknown numbers, no message', () => {
        expect(faultText(100, 'en')).to.equal('Outdoor sensor (B32): short circuit');
        expect(faultText(101, 'de')).to.equal('Außenfühler (B32): Unterbrechung');
        expect(faultText(197, 'fr')).to.contain('(B48)');
        expect(faultText(23, 'en')).to.equal('Low pressure fault - lockout');
        expect(faultText(997, 'de')).to.equal('Neustart');
        expect(faultText(777, 'de')).to.equal('Störung 777 (unbekannt)');
        expect(faultText(0, 'en')).to.equal('');
        expect(faultText(23, 'xx')).to.equal('Low pressure fault - lockout'); // unsupported language: English
    });

    it('differs between languages for the same number', () => {
        const texts = new Set(LANGUAGES.map(lang => faultText(22, lang)));
        expect(texts.size).to.be.greaterThan(8);
    });
});
