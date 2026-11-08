// A hand-in or a check, as text plus the attached file (photo, voice or document).
export default function HomeworkView({
  body, url, kind, name,
}: { body: string | null; url: string | null | undefined; kind: string | null; name: string | null }) {
  return (
    <div className="hw-view">
      {body && <div className="bubble-text">{body}</div>}
      {url && kind === 'image' && <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={name ?? ''} className="bubble-img" /></a>}
      {url && kind === 'audio' && <audio controls preload="metadata" src={url} className="bubble-audio" />}
      {url && kind === 'file' && <a href={url} target="_blank" rel="noreferrer" className="bubble-file">📎 {name}</a>}
    </div>
  );
}
