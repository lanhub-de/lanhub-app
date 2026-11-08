import Link from 'next/link';
import Shell, { Flash } from '@/components/Shell';
import UploadForm from '@/components/UploadForm';
import FolderUpload from '@/components/FolderUpload';
import Submit from '@/components/Submit';
import { requireProfile, TEACHING } from '@/lib/session';
import { folderPath, pathLabel, fmtSize, isAudio, type Folder, type LibFile } from '@/lib/library';
import { createFolder, deleteFile, deleteFolder, renameFolder, updateFile } from './actions';

type SP = { f?: string; q?: string; e?: string };

export default async function LibraryPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { supabase, profile, t } = await requireProfile(TEACHING);
  const sp = await searchParams;
  const canEdit = profile.role === 'owner' || profile.role === 'head_teacher';
  const [{ data: folderRows }, { data: fileRows }] = await Promise.all([
    supabase.from('library_folders').select('id, name, parent_id').order('created_at').returns<Folder[]>(),
    supabase.from('files').select('id, title, folder_id, level, staff_only, size_bytes, mime, visibility, uploaded_by')
      .order('title').returns<LibFile[]>(),
  ]);
  const folders = folderRows ?? [];
  const all = fileRows ?? [];
  const library = all.filter((f) => f.visibility === 'library');
  const mine = all.filter((f) => f.visibility === 'private' && f.uploaded_by === profile.id);
  const current = folders.some((f) => f.id === sp.f) ? sp.f! : null;
  const crumbs = folderPath(folders, current);
  const here = current ? `/library?f=${current}` : '/library';
  const q = (sp.q ?? '').trim().toLowerCase();

  // files below a folder, subfolders included
  const below = (id: string): number => library.filter((f) => f.folder_id === id).length
    + folders.filter((f) => f.parent_id === id).reduce((n, f) => n + below(f.id), 0);
  // top level in the order made (LanHub, Іспити, Групи); inside, by name (A1, A2, B1, B1+)
  const subfolders = folders.filter((f) => f.parent_id === current);
  if (current) subfolders.sort((a, b) => a.name.localeCompare(b.name, 'uk', { numeric: true }));
  const shown = q
    ? library.filter((f) => f.title.toLowerCase().includes(q) || pathLabel(folders, f.folder_id).toLowerCase().includes(q))
    : library.filter((f) => f.folder_id === current);
  const open = shown.filter((f) => !f.staff_only);
  const team = shown.filter((f) => f.staff_only);
  const folderOptions = folders.map((f) => ({ id: f.id, label: pathLabel(folders, f.id) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'uk', { numeric: true }));

  const fileRow = (f: LibFile) => (
    <div key={f.id} className="lib-row">
      <Link href={`/library/${f.id}`} className="lib-title">
        <span className="lib-icon" aria-hidden>{isAudio(f.mime) ? '🎧' : '📄'}</span>
        <span>
          {f.title}
          {q && f.folder_id && <span className="muted lib-where">{pathLabel(folders, f.folder_id)}</span>}
        </span>
      </Link>
      <span className="lib-meta">
        {f.level && (q || !crumbs.some((c) => c.name.toUpperCase() === f.level)) && <span className="pill">{f.level}</span>}
        <span className="muted">{fmtSize(f.size_bytes)}</span>
        {canEdit && (
          <details className="lib-edit">
            <summary className="link-btn">{t('libEdit')}</summary>
            <form action={updateFile} className="stack">
              <input type="hidden" name="id" value={f.id} />
              <input type="hidden" name="return_to" value={here} />
              <label>{t('title')}<input name="title" defaultValue={f.title} required /></label>
              <label>{t('libFolder')}
                <select name="folder_id" defaultValue={f.folder_id ?? ''}>
                  <option value="">{t('libNoFolder')}</option>
                  {folderOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </label>
              <label>{t('level')}<input name="level" defaultValue={f.level ?? ''} placeholder="A1, B1+…" /></label>
              <label className="check"><input type="checkbox" name="staff_only" defaultChecked={f.staff_only} /> {t('libTeamOnly')}</label>
              <Submit className="primary small">{t('save')}</Submit>
            </form>
            <details className="lib-danger">
              <summary className="link-btn">{t('libDelete')}</summary>
              <p className="muted" style={{ fontSize: 13 }}>{t('libDeleteWarn')}</p>
              <form action={deleteFile}>
                <input type="hidden" name="id" value={f.id} />
                <input type="hidden" name="return_to" value={here} />
                <Submit className="small danger">{t('libDeleteConfirm')}</Submit>
              </form>
            </details>
          </details>
        )}
      </span>
    </div>
  );

  return (
    <Shell profile={profile} t={t} active="/library">
      <div className="spread lib-head">
        <div>
          <h1>{t('library')}</h1>
          <p className="muted">{t('viewOnly')}</p>
        </div>
        <form className="lib-search" action="/library">
          <input type="search" name="q" defaultValue={sp.q ?? ''} placeholder={t('libSearch')} aria-label={t('libSearch')} />
        </form>
      </div>
      <Flash error={sp.e} />

      <div className="lib-layout">
        <section className="stack">
          {q ? (
            <p className="crumbs"><Link href={here}>{t('library')}</Link> › {t('libFound', { n: shown.length })}</p>
          ) : (
            <p className="crumbs">
              {crumbs.length ? <Link href="/library">{t('library')}</Link> : <strong>{t('library')}</strong>}
              {crumbs.map((c, i) => (
                <span key={c.id}> › {i === crumbs.length - 1 ? <strong>{c.name}</strong> : <Link href={`/library?f=${c.id}`}>{c.name}</Link>}</span>
              ))}
            </p>
          )}

          {!q && subfolders.length > 0 && (
            <div className="lib-folders">
              {subfolders.map((f) => (
                <Link key={f.id} href={`/library?f=${f.id}`} className="lib-folder">
                  <span className="lib-folder-icon" aria-hidden>📁</span>
                  <span className="lib-folder-name">{f.name}</span>
                  <span className="muted lib-folder-n">{t('libFilesN', { n: below(f.id) })}</span>
                </Link>
              ))}
            </div>
          )}

          {(open.length > 0 || (!team.length && !subfolders.length)) && (
            <div className="card">
              {(team.length > 0 || q) && <h2>{t('libMaterials')}</h2>}
              {open.length === 0 && <p className="muted">{t('nothingHere')}</p>}
              {open.map(fileRow)}
            </div>
          )}

          {team.length > 0 && (
            <div className="card lib-team">
              <h2>🔒 {t('libTeamOnly')}</h2>
              <p className="muted" style={{ fontSize: 13 }}>{t('libTeamOnlyHint')}</p>
              {team.map(fileRow)}
            </div>
          )}

          {!q && !current && mine.length > 0 && (
            <div className="card">
              <h2>{t('libMyFiles')}</h2>
              {mine.map(fileRow)}
            </div>
          )}
        </section>

        <aside className="stack">
          {canEdit ? (
            <>
              <div className="card">
                <h2>{t('libUploadTitle')}</h2>
                <FolderUpload
                  folderId={current}
                  folders={folders}
                  existing={library.map((f) => ({ folder_id: f.folder_id, title: f.title }))}
                  userId={profile.id}
                  labels={{
                    drop: t('upDrop'), pickFiles: t('upPickFiles'), pickFolder: t('upPickFolder'),
                    into: t('upInto'), contentsInto: t('upContentsInto'), done: t('upDone'),
                    skippedBig: t('upSkippedBig'), skippedType: t('upSkippedType'), skippedDup: t('upSkippedDup'),
                    failed: t('upFailed'), teamOnly: t('libTeamOnly'), root: t('library'),
                  }}
                />
              </div>
              <div className="card">
                <h2>{t('libNewFolder')}</h2>
                <form action={createFolder} className="row">
                  <input type="hidden" name="parent_id" value={current ?? ''} />
                  <input type="hidden" name="return_to" value={here} />
                  <input name="name" required placeholder={t('libFolderName')} aria-label={t('libFolderName')} style={{ flex: 1, minWidth: 0 }} />
                  <Submit className="small">{t('libCreate')}</Submit>
                </form>
                {current && (
                  <details style={{ marginTop: 10 }}>
                    <summary className="link-btn">{t('libRename')} · {t('libDeleteFolder')}</summary>
                    <form action={renameFolder} className="row" style={{ marginTop: 8 }}>
                      <input type="hidden" name="id" value={current} />
                      <input type="hidden" name="return_to" value={here} />
                      <input name="name" required defaultValue={crumbs.at(-1)?.name} aria-label={t('libFolderName')} style={{ flex: 1, minWidth: 0 }} />
                      <Submit className="small">{t('libRename')}</Submit>
                    </form>
                    <form action={deleteFolder} style={{ marginTop: 8 }}>
                      <input type="hidden" name="id" value={current} />
                      <input type="hidden" name="return_to" value={here} />
                      <Submit className="small danger">{t('libDeleteFolder')}</Submit>
                      <span className="muted" style={{ fontSize: 13, marginLeft: 8 }}>{t('libEmptyFolderHint')}</span>
                    </form>
                  </details>
                )}
              </div>
            </>
          ) : (
            <div className="card">
              <h2>{t('libOwnUpload')}</h2>
              <p className="muted" style={{ fontSize: 13 }}>{t('libOwnHint')}</p>
              <UploadForm
                userId={profile.id}
                canPublish={false}
                labels={{ title: t('title'), level: t('level'), file: t('file'), upload: t('upload'), library: t('library') }}
              />
            </div>
          )}
        </aside>
      </div>
    </Shell>
  );
}
