import dictionary from './dictionary.json';
import faults from './fault-messages.json';
import { LANGUAGES, type Language } from './translations';

type Entry = Record<string, string>;
const texts = dictionary as Record<string, Entry>;
const messages = faults.messages as Record<string, { text: string; sensor?: string }>;

const pick = (english: string, language: Language): string =>
    language === 'en' ? english : (texts[english]?.[language] ?? english);

/**
 * The text of a Navigator fault number in the given language (the numbers of the Navigator 2.0 operating manual, chapter 4,
 * 020-552 and the events 996-999). Unknown numbers get a neutral text with the number. Number 0 means no message: empty text.
 *
 * @param code the fault number from the Navigator
 * @param language ioBroker system language (`en`, `de`, ...); an unsupported language falls back to English
 */
export function faultText(code: number, language: string): string {
    if (code === 0) {
        return '';
    }
    const lang: Language = (LANGUAGES as readonly string[]).includes(language) ? (language as Language) : 'en';
    const message = messages[String(code)];
    if (!message) {
        return pick('Fault {code} (unknown)', lang).replace('{code}', String(code));
    }
    const text = pick(message.text, lang);
    return message.sensor ? text.replace('{sensor}', pick(message.sensor, lang)) : text;
}
