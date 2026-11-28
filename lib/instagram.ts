// A student's Instagram nickname, typed any way (@nick, nick, a profile link)
// or another contact such as a phone. Seen only by the owner and managers.
export function cleanInstagram(v: string) {
  return v.trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/^instagram\.com\//i, '')
    .replace(/[/?#].*$/, '')
    .replace(/^@/, '')
    .replace(/[‎‏‪-‮]/g, '')
    .trim()
    .slice(0, 100);
}

const isPhone = (h: string) => /^\+?[\d\s()-]{7,}$/.test(h);
export const instagramHref = (h: string) => (isPhone(h) ? null : `https://www.instagram.com/${encodeURIComponent(h)}/`);
export const instagramLabel = (h: string) => (isPhone(h) ? h : `@${h}`);
