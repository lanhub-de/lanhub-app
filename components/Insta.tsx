import { instagramHref, instagramLabel } from '@/lib/instagram';

// The nickname as a link to her Instagram (a phone stays plain text).
export default function Insta({ handle, className = 'insta' }: { handle?: string | null; className?: string }) {
  if (!handle) return null;
  const href = instagramHref(handle);
  return href
    ? <a href={href} target="_blank" rel="noreferrer" className={className}>{instagramLabel(handle)}</a>
    : <span className={className}>{instagramLabel(handle)}</span>;
}
