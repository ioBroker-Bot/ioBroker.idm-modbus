import dictionary from './dictionary.json';

/** The 11 languages ioBroker supports; every user-visible text exists in all of them. */
export const LANGUAGES = ['en', 'de', 'ru', 'pt', 'nl', 'fr', 'it', 'es', 'pl', 'uk', 'zh-cn'] as const;

/** One of the supported languages. */
export type Language = (typeof LANGUAGES)[number];

/** A text in all supported languages. */
export type LocalizedText = Record<Language, string>;

/**
 * One language of a localized text. ioBroker allows translated names, but `common.states` and similar fields only hold plain
 * strings (translated objects show up as "[object Object]"), so those are written in the system language.
 *
 * @param text the localized text
 * @param language ioBroker system language; an unsupported or missing one falls back to English
 */
export function textIn(text: LocalizedText, language: string | undefined): string {
    return text[(LANGUAGES as readonly string[]).includes(language ?? '') ? (language as Language) : 'en'];
}

/** Translations by English template; `en` is the key itself, German comes from the IDM documents or our own wording. */
export type Dictionary = Record<string, Partial<Record<Exclude<Language, 'en'>, string>>>;

/**
 * Replace `{name}` and `{name:l}` (lower case) placeholders.
 *
 * @param text template
 * @param vars values by placeholder name
 * @throws {Error} on a placeholder without a value
 */
export function fillPlaceholders(text: string, vars: Record<string, string>): string {
    return text.replace(/\{(\w+)(:l)?\}/g, (_match, name: string, lower?: string) => {
        const value = vars[name];
        if (value === undefined) {
            throw new Error(`Unknown placeholder {${name}} in "${text}"`);
        }
        return lower ? value.toLowerCase() : value;
    });
}

/**
 * Languages that have no entry for an English template (empty = complete).
 *
 * @param english English template
 * @param source the dictionary to check
 */
export function missingLanguages(english: string, source: Dictionary = dictionary): Language[] {
    const entry = source[english];
    return LANGUAGES.filter(lang => lang !== 'en' && !entry?.[lang]);
}

/**
 * The text in all languages. An English template without a (complete) dictionary entry falls back to English for the
 * missing languages; the tests make sure that does not happen for any text the adapter uses.
 *
 * @param english English template, key of the dictionary
 * @param vars values for placeholders
 * @param source the dictionary (default: the shipped one)
 */
export function localized(
    english: string,
    vars: Record<string, string> = {},
    source: Dictionary = dictionary,
): LocalizedText {
    const entry = source[english] ?? {};
    const result = {} as LocalizedText;
    for (const lang of LANGUAGES) {
        const template = lang === 'en' ? english : (entry[lang] ?? english);
        result[lang] = fillPlaceholders(template, vars);
    }
    return result;
}
