import { ru } from './ru';
import { en } from './en';

export type Lang = 'ru' | 'en';
export type TKey = keyof typeof ru;

const DICTS: Record<Lang, Record<TKey, string>> = { ru, en };

let lang: Lang = detectLang();

export function detectLang(): Lang {
  try {
    const l = (navigator.languages?.[0] ?? navigator.language ?? 'ru').toLowerCase();
    if (l.startsWith('ru') || l.startsWith('uk') || l.startsWith('be') || l.startsWith('kk')) return 'ru';
    return 'en';
  } catch {
    return 'ru';
  }
}

export function setLang(l: Lang | 'auto'): void {
  lang = l === 'auto' ? detectLang() : l;
  try {
    document.documentElement.lang = lang;
  } catch {
    /* ignore */
  }
}

export function getLang(): Lang {
  return lang;
}

export function t(k: TKey, params?: Record<string, string | number>): string {
  const s = DICTS[lang][k] ?? ru[k] ?? k;
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, p) => (p in params ? String(params[p]) : m));
}

/** Russian-style plural picker (one / few / many); English uses one / many. */
export function plural(n: number, one: TKey, few: TKey, many: TKey): string {
  const a = Math.abs(n);
  if (lang === 'en') return t(a === 1 ? one : many);
  const m10 = a % 10, m100 = a % 100;
  if (m10 === 1 && m100 !== 11) return t(one);
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return t(few);
  return t(many);
}

/** Russian plural form index for n: 0 = one (1, 21…), 1 = few (2–4, 22–24…), 2 = many (0, 5–20, 25…). */
export function ruPluralIndex(n: number): 0 | 1 | 2 {
  const a = Math.abs(Math.trunc(n));
  const m10 = a % 10, m100 = a % 100;
  if (m10 === 1 && m100 !== 11) return 0;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 1;
  return 2;
}

/**
 * Word for a count from a "|"-separated dictionary entry: ru "уровень|уровня|уровней",
 * en "level|levels". `pn(5, 'pl_level')` → "5 уровней".
 */
export function pw(n: number, k: TKey): string {
  const forms = t(k).split('|');
  if (lang === 'en') return forms[Math.abs(n) === 1 ? 0 : forms.length - 1];
  return forms[Math.min(ruPluralIndex(n), forms.length - 1)];
}

export function pn(n: number, k: TKey): string {
  return `${n} ${pw(n, k)}`;
}
