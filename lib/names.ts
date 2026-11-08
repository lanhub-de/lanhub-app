import type { Locale } from '@/lib/i18n';

// Ukrainian instrumental case of a first name ("з Ганною", "з Надією") for
// the common endings; anything else (Latin names, unusual endings) is left as
// it is and the caller uses a form that needs no case.
export function instrumental(name: string): string | null {
  const first = name.trim().split(/\s+/)[0] ?? '';
  if (!/^[А-ЩЬЮЯІЇЄҐа-щьюяіїєґ'’-]+$/.test(first)) return null;
  if (/ія$/.test(first)) return `${first.slice(0, -2)}ією`;
  if (/я$/.test(first)) return `${first.slice(0, -1)}ею`;
  if (/[жчшщ]а$/.test(first)) return `${first.slice(0, -1)}ею`;
  if (/а$/.test(first)) return `${first.slice(0, -1)}ою`;
  if (/[бвгґдзклмнпстфх]$/.test(first)) return `${first}ом`;
  return null;
}

// "з Ганною" / "with Hanna" (or just the name when the case is unknown).
export function withName(name: string, locale: Locale) {
  if (locale === 'en') return `with ${name.split(' ')[0]}`;
  const i = instrumental(name);
  return i ? `з ${i}` : name.split(' ')[0];
}

// "Чат з Ганною" / "Chat with Hanna" / "Чат: Sydney".
export function chatWith(name: string, locale: Locale) {
  if (locale === 'en') return `Chat with ${name.split(' ')[0]}`;
  const i = instrumental(name);
  return i ? `Чат з ${i}` : `Чат: ${name.split(' ')[0]}`;
}

// A student card's name as first / last for the forms, and her Instagram
// nickname (from contact) if the card still carries it as the name.
export function splitStudentName(fullName: string, contact?: string | null) {
  const handle = contact?.match(/@([\w.]+)/)?.[1] ?? null;
  const looksLikeNick = (handle && fullName.toLowerCase().startsWith(handle.toLowerCase()))
    || /[_\d.@]/.test(fullName) || !/\s/.test(fullName.trim()) && /[a-z][A-Z]|^[a-z]/.test(fullName.trim());
  if (looksLikeNick) return { first: '', last: '', handle: handle ?? fullName, nick: true };
  const [first, ...rest] = fullName.trim().split(/\s+/);
  return { first: first ?? '', last: rest.join(' '), handle, nick: false };
}
