/**
 * Writes `www/labels.json`: the texts of the heat pump diagram page in all 11 languages, taken from `src/lib/dictionary.json`
 * (the page runs in the browser and cannot read the dictionary of the adapter). `npm test` fails when the file is out of date.
 *
 * Usage: `npm run build:diagram`
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { LANGUAGES, localized } from '../src/lib/translations';

const root = path.join(__dirname, '..');

/**
 * The diagram texts by key, each in all languages.
 *
 * @returns the content of `www/labels.json`
 */
export function buildDiagramLabels(): Record<string, Record<string, string>> {
    const source = JSON.parse(fs.readFileSync(path.join(root, 'tools', 'sources', 'diagram-labels.json'), 'utf8')) as {
        labels: Record<string, { en: string }>;
    };
    const result: Record<string, Record<string, string>> = {};
    for (const [key, { en: english }] of Object.entries(source.labels)) {
        // placeholders like {i} stay in the text, the page fills them in
        const keep = Object.fromEntries([...english.matchAll(/\{(\w+)\}/g)].map(match => [match[1], match[0]]));
        const texts = localized(english, keep) as Record<string, string>;
        result[key] = Object.fromEntries(LANGUAGES.map(language => [language, texts[language]]));
    }
    return result;
}

if (require.main === module) {
    fs.writeFileSync(path.join(root, 'www', 'labels.json'), `${JSON.stringify(buildDiagramLabels(), null, 4)}\n`);
    console.log('www/labels.json written');
}
