import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import dictionary from './dictionary.json';
import { loadRegisters } from './registers/plant';
import type { RegisterEntry } from './registers/types';
import { type Dictionary, LANGUAGES, type LocalizedText, localized, missingLanguages } from './translations';

const root = path.join(__dirname, '..', '..');
const readJson = <T>(...parts: string[]): T => JSON.parse(fs.readFileSync(path.join(root, ...parts), 'utf8')) as T;
const placeholders = (text: string): string[] => (text.match(/\{\w+\}/g) ?? []).sort();

describe('translations', () => {
    it('the dictionary is complete: every text exists in all 11 languages', () => {
        const incomplete = Object.keys(dictionary).filter(
            key => missingLanguages(key, dictionary as Dictionary).length,
        );
        expect(
            incomplete,
            `incomplete: ${incomplete.slice(0, 5).join(' | ')} (run npm run translate:strings)`,
        ).to.deep.equal([]);
    });

    it('keeps the placeholders of the English text in every language', () => {
        for (const [english, entry] of Object.entries(dictionary as Dictionary)) {
            for (const lang of LANGUAGES.filter(l => l !== 'en')) {
                expect(placeholders(entry[lang] ?? ''), `${lang}: ${english}`).to.deep.equal(placeholders(english));
            }
        }
    });

    it('covers every runtime name the adapter creates', () => {
        const names = Object.keys(
            readJson<{ names: Record<string, string> }>('tools', 'sources', 'runtime-names.json').names,
        );
        expect(names.filter(n => missingLanguages(n, dictionary as Dictionary).length)).to.deep.equal([]);
    });

    it('covers every label and enum text of the generated register files in all languages', () => {
        const registers = loadRegisters('nav20') as RegisterEntry[];
        const check = (text: LocalizedText, what: string): void => {
            for (const lang of LANGUAGES) {
                expect(text[lang], `${what} (${lang})`).to.be.a('string').and.not.equal('');
                expect(text[lang], `${what} (${lang}) has an unfilled placeholder`).to.not.match(/[{}]/);
            }
        };
        for (const reg of registers) {
            check(reg.label, `${reg.id} label`);
            Object.entries(reg.enum ?? {}).forEach(([value, text]) => check(text, `${reg.id} enum ${value}`));
        }
    });

    it('translates the instance object names in io-package.json into all languages', () => {
        const ioPackage = readJson<{ instanceObjects: { _id: string; common?: { name?: Record<string, string> } }[] }>(
            'io-package.json',
        );
        for (const object of ioPackage.instanceObjects) {
            const name = object.common?.name;
            expect(name, `${object._id} name`).to.be.an('object');
            for (const lang of LANGUAGES) {
                expect(name?.[lang], `${object._id} (${lang})`).to.be.a('string').and.not.equal('');
            }
        }
    });

    it('has every admin UI key in all 11 languages', () => {
        const english = readJson<Record<string, string>>('admin', 'i18n', 'en.json');
        for (const lang of LANGUAGES) {
            const texts = readJson<Record<string, string>>('admin', 'i18n', `${lang}.json`);
            const missing = Object.keys(english).filter(key => !texts[key]);
            expect(
                missing,
                `admin/i18n/${lang}.json lacks ${missing.slice(0, 5).join(', ')} (run npm run translate)`,
            ).to.deep.equal([]);
        }
    });

    it('fills placeholders when localizing', () => {
        const text = localized('Room {r}', { r: '3' });
        expect(text.en).to.equal('Room 3');
        expect(text.de).to.equal('Raum 3');
    });
});
