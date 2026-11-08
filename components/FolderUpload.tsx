'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { folderPath, levelOf, looksTeamOnly, tidyTitle, MAX_BYTES, type Folder } from '@/lib/library';

export type UploadLabels = {
  drop: string; pickFiles: string; pickFolder: string; into: string; contentsInto: string;
  done: string; skippedBig: string; skippedType: string; skippedDup: string; failed: string; teamOnly: string; root: string;
};
type Item = { file: File; dirs: string[] };
type Row = { name: string; state: 'wait' | 'up' | 'ok' | 'skip' | 'err'; note?: string; team?: boolean };

const AUDIO: Record<string, string> = { mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg' };
const ext = (n: string) => (n.split('.').pop() ?? '').toLowerCase();

// Reads a dropped folder (and its subfolders) into a flat list of files.
async function readEntry(entry: FileSystemEntry, dirs: string[], out: Item[]) {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    out.push({ file, dirs });
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const e of batch) await readEntry(e, [...dirs, entry.name], out);
    }
  }
}

// PDFs and audio straight into the current library folder. A dropped folder's
// contents land here with its subfolders kept; teacher guides go team-only.
export default function FolderUpload({ folderId, folders, existing, userId, labels }: {
  folderId: string | null; folders: Folder[]; existing: { folder_id: string | null; title: string }[];
  userId: string; labels: UploadLabels;
}) {
  const router = useRouter();
  const filesInput = useRef<HTMLInputElement>(null);
  const dirInput = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const here = folderPath(folders, folderId);
  const hereName = here.at(-1)?.name ?? labels.root;

  async function run(items: Item[]) {
    if (!items.length || busy) return;
    // one dropped folder: its contents go into the current folder
    const tops = new Set(items.map((i) => i.dirs[0] ?? ''));
    if (tops.size === 1 && !tops.has('')) {
      setNote(labels.contentsInto.replace('{a}', [...tops][0]).replace('{b}', hereName));
      items = items.map((i) => ({ ...i, dirs: i.dirs.slice(1) }));
    } else setNote('');
    items = items.filter((i) => !i.file.name.startsWith('.'));
    setBusy(true);
    const sb = supabaseBrowser();
    const known = new Map<string, string | null>([['', folderId]]);
    const seen = new Set(existing.map((e) => `${e.folder_id ?? ''}|${e.title.toLowerCase()}`));
    const list: Row[] = items.map((i) => ({ name: [...i.dirs, i.file.name].join(' / '), state: 'wait' }));
    setRows([...list]);
    const set = (k: number, r: Partial<Row>) => { list[k] = { ...list[k], ...r }; setRows([...list]); };

    async function folderFor(dirs: string[]): Promise<string | null> {
      let parent = folderId;
      for (let d = 1; d <= dirs.length; d++) {
        const key = dirs.slice(0, d).join('/');
        if (known.has(key)) { parent = known.get(key)!; continue; }
        const name = dirs[d - 1].trim();
        const local = folders.find((f) => f.parent_id === parent && f.name.toLowerCase() === name.toLowerCase());
        let id = local?.id ?? null;
        if (!id) {
          const ins = await sb.from('library_folders').insert({ name, parent_id: parent }).select('id').single();
          if (ins.data) id = ins.data.id;
          else {
            let q = sb.from('library_folders').select('id').ilike('name', name.replace(/[%_\\]/g, (c) => `\\${c}`));
            q = parent ? q.eq('parent_id', parent) : q.is('parent_id', null);
            id = (await q.maybeSingle()).data?.id ?? null;
          }
        }
        known.set(key, id);
        parent = id;
      }
      return parent;
    }

    let next = 0;
    async function worker() {
      while (next < items.length) {
        const k = next++;
        const { file, dirs } = items[k];
        const e = ext(file.name);
        const mime = e === 'pdf' ? 'application/pdf' : AUDIO[e];
        if (!mime) { set(k, { state: 'skip', note: labels.skippedType }); continue; }
        if (file.size > MAX_BYTES) { set(k, { state: 'skip', note: labels.skippedBig }); continue; }
        set(k, { state: 'up' });
        try {
          const target = await folderFor(dirs);
          const title = tidyTitle(file.name);
          const dupKey = `${target ?? ''}|${title.toLowerCase()}`;
          if (seen.has(dupKey)) { set(k, { state: 'skip', note: labels.skippedDup }); continue; }
          seen.add(dupKey);
          const names = [...here.map((f) => f.name), ...dirs];
          const team = looksTeamOnly(file.name) || names.some(looksTeamOnly);
          const id = crypto.randomUUID();
          const path = `library/${id}.${e}`;
          const up = await sb.storage.from('files').upload(path, file, { contentType: mime });
          if (up.error) throw up.error;
          const ins = await sb.from('files').insert({
            id, title, storage_path: path, mime, visibility: 'library', folder_id: target,
            level: levelOf(names), staff_only: team, size_bytes: file.size, uploaded_by: userId,
          });
          if (ins.error) { await sb.storage.from('files').remove([path]); throw ins.error; }
          set(k, { state: 'ok', team });
        } catch (err) {
          set(k, { state: 'err', note: (err as Error).message || labels.failed });
        }
      }
    }
    await Promise.all([worker(), worker()]);
    setBusy(false);
    router.refresh();
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setOver(false);
    const items: Item[] = [];
    const entries = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
    if (entries.length) for (const en of entries) await readEntry(en, [], items);
    else for (const f of [...e.dataTransfer.files]) items.push({ file: f, dirs: [] });
    run(items);
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const items = [...(e.target.files ?? [])].map((file) => {
      const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || '';
      return { file, dirs: rel ? rel.split('/').slice(0, -1) : [] };
    });
    e.target.value = '';
    run(items);
  }

  const ok = rows.filter((r) => r.state === 'ok').length;
  const total = rows.filter((r) => r.state !== 'skip').length;

  return (
    <div className="stack">
      <div
        className={`dropzone lib-drop${over ? ' over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <p>{labels.drop}</p>
        <p className="muted">{labels.into.replace('{f}', hereName)}</p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <button type="button" className="small" disabled={busy} onClick={() => filesInput.current?.click()}>{labels.pickFiles}</button>
          <button type="button" className="small" disabled={busy} onClick={() => dirInput.current?.click()}>{labels.pickFolder}</button>
        </div>
        <input ref={filesInput} type="file" multiple accept="application/pdf,audio/*" hidden onChange={onPick} />
        <input ref={dirInput} type="file" multiple hidden onChange={onPick}
          {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} />
      </div>
      {note && <p className="muted" style={{ fontSize: 13 }}>{note}</p>}
      {rows.length > 0 && (
        <div className="up-list">
          <p className="muted" style={{ fontSize: 13 }}>{labels.done.replace('{n}', String(ok)).replace('{m}', String(total))}</p>
          {rows.map((r, i) => (
            <div key={i} className={`up-row ${r.state}`}>
              <span className="up-name">{r.name}</span>
              <span className="up-state">
                {r.state === 'up' ? '…' : r.state === 'ok' ? (r.team ? `✓ ${labels.teamOnly}` : '✓') : r.state === 'wait' ? '' : r.note}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
