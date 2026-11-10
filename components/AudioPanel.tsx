'use client';
import { addAudio, removeAudio } from '@/app/library/actions';
import Submit from '@/components/Submit';

export type Track = { id: string; page: number; label: string | null; title: string; url: string };
export type AudioOption = { id: string; title: string; group: string };
export type AudioLabels = {
  title: string; onPage: string; none: string; all: string; page: string; add: string;
  track: string; label: string; labelHint: string; remove: string;
};

// Next to a textbook: the tracks for the page on screen, then every track by
// page (a click jumps there). The school edits which track goes where.
export default function AudioPanel({ fileId, tracks, page, setPage, labels, options }: {
  fileId: string; tracks: Track[]; page: number; setPage: (n: number) => void;
  labels: AudioLabels; options?: AudioOption[];
}) {
  const here = tracks.filter((t) => t.page === page);
  const groups = options ? [...new Set(options.map((o) => o.group))] : [];
  return (
    <aside className="audio-panel card">
      <h2>🎧 {labels.title}</h2>
      <p className="muted audio-sub">{labels.onPage.replace('{n}', String(page))}</p>
      {here.length === 0 && <p className="muted" style={{ fontSize: 13 }}>{labels.none}</p>}
      {here.map((t) => (
        <div key={t.id} className="audio-track">
          <div className="audio-name">
            <strong>{t.label || t.title}</strong>
            {t.label && <span className="muted">{t.title}</span>}
          </div>
          <audio controls controlsList="nodownload" preload="none" src={t.url} />
          {options && (
            <form action={removeAudio}>
              <input type="hidden" name="id" value={t.id} />
              <input type="hidden" name="file_id" value={fileId} />
              <button type="submit" className="link-btn audio-remove">{labels.remove}</button>
            </form>
          )}
        </div>
      ))}

      {options && (
        <details className="audio-add">
          <summary className="link-btn">+ {labels.add.replace('{n}', String(page))}</summary>
          <form action={addAudio} className="stack">
            <input type="hidden" name="file_id" value={fileId} />
            <input type="hidden" name="page" value={page} />
            <label>{labels.track}
              <select name="audio_id" required defaultValue="">
                <option value="" disabled>…</option>
                {groups.map((g) => (
                  <optgroup key={g} label={g}>
                    {options.filter((o) => o.group === g).map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            <label>{labels.label}<input name="label" placeholder={labels.labelHint} /></label>
            <Submit className="primary small">{labels.add.replace('{n}', String(page))}</Submit>
          </form>
        </details>
      )}

      {tracks.length > 0 && (
        <details className="audio-all" open={tracks.length <= 12}>
          <summary>{labels.all.replace('{n}', String(tracks.length))}</summary>
          <ul>
            {tracks.map((t) => (
              <li key={t.id}>
                <button type="button" className={`link-btn${t.page === page ? ' on' : ''}`} onClick={() => setPage(t.page)}>
                  {labels.page.replace('{n}', String(t.page))}
                </button>
                <span>{t.label || t.title}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </aside>
  );
}
