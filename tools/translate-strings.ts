/**
 * Fills `src/lib/dictionary.json` (English template -> 11 languages) and the names in `io-package.json`.
 *
 * Strings come from the register source files (labels and enum texts, English + German from the IDM documents) and
 * from `tools/sources/runtime-names.json`. Only missing languages are translated, with the online translator of
 * `@iobroker/adapter-dev` (the same one `npm run translate` uses). Placeholders like `{i}` are swapped for a token
 * (`QQ1`) before translating and checked afterwards; a text whose placeholders did not survive stays untranslated
 * and makes `npm run build:registers` and the tests fail until it is fixed by hand in the dictionary.
 *
 * Usage: `npm run translate:strings` (needs network; resumable, saves as it goes).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { LANGUAGES, type Dictionary, type Language, localized } from '../src/lib/translations';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const translator = require('@iobroker/adapter-dev/build/translate.js') as {
    translateText(text: string, lang: string, key?: string): Promise<string>;
    resetRateLimitState(): void;
};

const root = path.join(__dirname, '..');
const dictionaryPath = path.join(root, 'src', 'lib', 'dictionary.json');

/** Pause between requests so the free translator is not hammered. */
const REQUEST_PAUSE_MS = 50;
/** Languages translated at the same time; the free translator throttles above a handful of parallel requests. */
const CONCURRENCY = 3;
/** Shared by all requests: set while a rate limit pause is running so they wait together instead of hammering again. */
let pausedUntil = 0;
/** Attempts per text and language before giving up on it. */
const MAX_ATTEMPTS = 3;

/**
 * Wait without a bare global timer in library code (this is a tool, not adapter code).
 *
 * @param ms milliseconds
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** Collect English -> German pairs from the register sources and the runtime names. */
function collectStrings(): Map<string, string> {
    const strings = new Map<string, string>();
    const add = (en: string, de: string, origin: string): void => {
        const known = strings.get(en);
        if (known !== undefined && known !== de) {
            // Register sources keep their own German per entry (binding IDM wording), so only runtime names matter here.
            if (origin === 'runtime-names.json') {
                console.warn(`Different German for "${en}": "${known}" vs "${de}" - keeping the first`);
            }
            return;
        }
        strings.set(en, de);
    };
    for (const file of fs.readdirSync(path.join(root, 'tools', 'sources')).filter(f => f.endsWith('.source.json'))) {
        const source = JSON.parse(fs.readFileSync(path.join(root, 'tools', 'sources', file), 'utf8')) as {
            entries: { label: { en: string; de: string }; enum?: Record<string, { en: string; de: string }> }[];
        };
        for (const entry of source.entries) {
            add(entry.label.en, entry.label.de, file);
            Object.values(entry.enum ?? {}).forEach(t => add(t.en, t.de, file));
        }
    }
    const runtime = JSON.parse(fs.readFileSync(path.join(root, 'tools', 'sources', 'runtime-names.json'), 'utf8')) as {
        names: Record<string, string>;
    };
    Object.entries(runtime.names).forEach(([en, de]) => add(en, de, 'runtime-names.json'));
    return strings;
}

/**
 * Translate one template, protecting its placeholders.
 *
 * @param english English template
 * @param lang target language
 * @returns the translation, or `null` when the placeholders did not survive
 */
async function translateTemplate(english: string, lang: Language): Promise<string | null> {
    const names = [...new Set([...english.matchAll(/\{(\w+)\}/g)].map(m => m[1]))];
    let masked = english;
    names.forEach((name, i) => {
        masked = masked.split(`{${name}}`).join(`QQ${i + 1}`);
    });
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            let translated = await translator.translateText(masked, lang, english);
            await sleep(REQUEST_PAUSE_MS);
            let intact = translated.trim() !== '';
            names.forEach((name, i) => {
                const token = `QQ${i + 1}`;
                const expected = masked.split(token).length - 1;
                if (translated.split(token).length - 1 !== expected) {
                    intact = false;
                }
                translated = translated.split(token).join(`{${name}}`);
            });
            // translateText() returns the source text unchanged when the request failed (timeout, 5xx). A genuinely
            // identical translation ("Solar", "ISC") shows up again on the next attempt, a failure usually does not.
            const unchanged = translated === english && /[a-z]{3}/i.test(english);
            if (intact && (!unchanged || attempt === MAX_ATTEMPTS)) {
                return translated;
            }
        } catch (error) {
            const message = (error as Error).message;
            if (/rate|skipped/i.test(message)) {
                if (Date.now() >= pausedUntil) {
                    console.warn(`Rate limited, waiting 90 s (${message})`);
                    pausedUntil = Date.now() + 90000;
                }
                await sleep(Math.max(0, pausedUntil - Date.now()) + 500);
                translator.resetRateLimitState();
                attempt--; // a rate limit pause is not a failed attempt
            } else {
                await sleep(2000);
            }
        }
    }
    return null;
}

/** CLI entry. */
async function main(): Promise<void> {
    const strings = collectStrings();
    const dictionary: Dictionary = fs.existsSync(dictionaryPath)
        ? (JSON.parse(fs.readFileSync(dictionaryPath, 'utf8')) as Dictionary)
        : {};
    const save = (): void => {
        const sorted = Object.fromEntries(
            Object.keys(dictionary)
                .sort()
                .map(k => [k, dictionary[k]]),
        );
        fs.writeFileSync(dictionaryPath, `${JSON.stringify(sorted, null, 4)}\n`);
    };

    let done = 0;
    const failed: string[] = [];
    for (const [english, german] of strings) {
        const entry = (dictionary[english] ??= {});
        entry.de = german;
        // The languages are independent, so translate them in parallel (one text at a time keeps the request rate modest).
        const missing = LANGUAGES.filter(l => l !== 'en' && l !== 'de' && !entry[l]);
        const results: { lang: Language; text: string | null }[] = [];
        for (let i = 0; i < missing.length; i += CONCURRENCY) {
            results.push(
                ...(await Promise.all(
                    missing
                        .slice(i, i + CONCURRENCY)
                        .map(async lang => ({ lang, text: await translateTemplate(english, lang) })),
                )),
            );
        }
        for (const { lang, text } of results) {
            if (text === null) {
                failed.push(`${lang}: ${english}`);
            } else {
                entry[lang as Exclude<Language, 'en'>] = text;
                done++;
            }
        }
        save();
    }
    // Drop entries that no source uses any more.
    for (const key of Object.keys(dictionary)) {
        if (!strings.has(key)) {
            delete dictionary[key];
        }
    }
    save();
    console.log(`${strings.size} texts, ${done} new translations, ${failed.length} failed`);
    failed.forEach(f => console.log(`  FAILED ${f}`));

    syncIoPackage();
    if (failed.length) {
        process.exit(1);
    }
}

/** Write the translated names into the instance objects of io-package.json. */
function syncIoPackage(): void {
    const file = path.join(root, 'io-package.json');
    const ioPackage = JSON.parse(fs.readFileSync(file, 'utf8')) as {
        instanceObjects: { common?: { name?: { en?: string } | string } }[];
    };
    let changed = 0;
    for (const object of ioPackage.instanceObjects) {
        const name = object.common?.name;
        const english = typeof name === 'string' ? name : name?.en;
        if (object.common && english) {
            object.common.name = localized(english);
            changed++;
        }
    }
    fs.writeFileSync(file, `${JSON.stringify(ioPackage, null, 2)}\n`);
    console.log(`io-package.json: ${changed} instance object names synced`);
}

main().catch((error: Error) => {
    console.error(error.message);
    process.exit(1);
});
