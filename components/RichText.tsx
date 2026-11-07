import { Fragment } from 'react';

// A tiny, safe formatter for lesson texts written in the program editor:
// **bold**, *italic*, ~~crossed out~~, and lines starting with "- " as a list.
// Nothing is injected as HTML.
function inline(text: string, key: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|~~[^~]+~~|\*[^*]+\*)/g).filter(Boolean);
  return parts.map((p, i) => {
    const k = `${key}-${i}`;
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={k}>{p.slice(2, -2)}</strong>;
    if (p.startsWith('~~') && p.endsWith('~~')) return <s key={k}>{p.slice(2, -2)}</s>;
    if (p.startsWith('*') && p.endsWith('*') && p.length > 2) return <em key={k}>{p.slice(1, -1)}</em>;
    return <Fragment key={k}>{p}</Fragment>;
  });
}

export default function RichText({ text, className }: { text: string | null | undefined; className?: string }) {
  if (!text) return null;
  const blocks: { list: boolean; lines: string[] }[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) { blocks.push({ list: false, lines: [] }); continue; }
    const isItem = line.trimStart().startsWith('- ');
    const last = blocks[blocks.length - 1];
    if (last && last.list === isItem && last.lines.length) last.lines.push(isItem ? line.trimStart().slice(2) : line);
    else blocks.push({ list: isItem, lines: [isItem ? line.trimStart().slice(2) : line] });
  }
  return (
    <div className={`rich ${className ?? ''}`}>
      {blocks.filter((b) => b.lines.length).map((b, i) => b.list ? (
        <ul key={i}>{b.lines.map((l, j) => <li key={j}>{inline(l, `${i}-${j}`)}</li>)}</ul>
      ) : (
        b.lines.map((l, j) => <p key={`${i}-${j}`}>{inline(l, `${i}-${j}`)}</p>)
      ))}
    </div>
  );
}
