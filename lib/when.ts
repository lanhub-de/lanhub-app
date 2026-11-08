// Short dates as on the mockups: "чт 5.11" / "Thu 5/11", "16:00".
export function shortDay(iso: string, locale: string, tz?: string) {
  const loc = locale === 'uk' ? 'uk-UA' : 'en-GB';
  const parts = new Intl.DateTimeFormat(loc, { timeZone: tz, weekday: 'short', day: 'numeric', month: 'numeric' }).formatToParts(new Date(iso));
  const get = (k: string) => parts.find((p) => p.type === k)?.value ?? '';
  return `${get('weekday')} ${Number(get('day'))}${locale === 'uk' ? '.' : '/'}${Number(get('month'))}`;
}
export function hhmm(iso: string, locale: string, tz?: string) {
  return new Intl.DateTimeFormat(locale === 'uk' ? 'uk-UA' : 'en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}
export function dayKey(d: Date | string, tz?: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, dateStyle: 'short' }).format(new Date(d));
}
// "18 грудня" / "18 December" (no year), for dates within the coming months.
export function dayMonth(iso: string, locale: string) {
  return new Intl.DateTimeFormat(locale === 'uk' ? 'uk-UA' : 'en-GB', { day: 'numeric', month: 'long', timeZone: 'Europe/Kyiv' }).format(new Date(iso));
}
