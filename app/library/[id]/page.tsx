import Link from 'next/link';
import { notFound } from 'next/navigation';
import Shell, { Flash } from '@/components/Shell';
import PdfViewer from '@/components/PdfViewer';
import type { AudioOption, Track } from '@/components/AudioPanel';
import { requireProfile, TEACHING } from '@/lib/session';
import { isAudio, pathLabel, type Folder } from '@/lib/library';

const LINK_SECONDS = 3 * 60 * 60;

export default async function ViewFile({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ e?: string }> }) {
  const { supabase, profile, t } = await requireProfile(TEACHING);
  const { id } = await params;
  const { e } = await searchParams;
  const canEdit = profile.role === 'owner' || profile.role === 'head_teacher';
  const { data: file } = await supabase.from('files')
    .select('id, title, level, storage_path, mime, folder_id, staff_only').eq('id', id).maybeSingle();
  if (!file) notFound();
  // The link lasts a lesson (pages load as they are turned), then stops working.
  const { data: signed } = await supabase.storage.from('files').createSignedUrl(file.storage_path, LINK_SECONDS);
  if (!signed?.signedUrl) notFound();
  await supabase.from('file_access_log').insert({ file_id: file.id, profile_id: profile.id });
  const { data: folder } = file.folder_id
    ? await supabase.from('library_folders').select('id, name').eq('id', file.folder_id).maybeSingle()
    : { data: null };

  // Audio by page for a textbook: the tracks with short-lived links; the
  // school also gets every audio file in the library to add more.
  let audio: { fileId: string; tracks: Track[]; options?: AudioOption[] } | null = null;
  if (!isAudio(file.mime)) {
    const { data: rows } = await supabase.from('file_audio')
      .select('id, page, label, position, files!file_audio_audio_id_fkey(title, storage_path)')
      .eq('file_id', file.id).order('page').order('position')
      .returns<{ id: string; page: number; label: string | null; files: { title: string; storage_path: string } | null }[]>();
    const mapped = (rows ?? []).filter((r) => r.files);
    const paths = [...new Set(mapped.map((r) => r.files!.storage_path))];
    const { data: urls } = paths.length
      ? await supabase.storage.from('files').createSignedUrls(paths, LINK_SECONDS)
      : { data: [] as { path: string | null; signedUrl: string }[] };
    const urlOf = new Map((urls ?? []).map((u) => [u.path, u.signedUrl]));
    const tracks = mapped.map((r) => ({ id: r.id, page: r.page, label: r.label, title: r.files!.title, url: urlOf.get(r.files!.storage_path) ?? '' }));
    let options: AudioOption[] | undefined;
    if (canEdit) {
      const [{ data: audioFiles }, { data: folders }] = await Promise.all([
        supabase.from('files').select('id, title, folder_id').like('mime', 'audio/%').order('title'),
        supabase.from('library_folders').select('id, name, parent_id').returns<Folder[]>(),
      ]);
      options = (audioFiles ?? []).map((a) => ({ id: a.id, title: a.title, group: pathLabel(folders ?? [], a.folder_id) || t('libNoFolder') }))
        .sort((a, b) => a.group.localeCompare(b.group, 'uk') || a.title.localeCompare(b.title, 'de', { numeric: true }));
    }
    if (tracks.length || canEdit) audio = { fileId: file.id, tracks, options };
  }

  return (
    <Shell profile={profile} t={t} active="/library">
      <p><Link href={folder ? `/library?f=${folder.id}` : '/library'}>← {folder?.name ?? t('library')}</Link></p>
      <h1>{file.title}{file.staff_only ? <span className="pill" style={{ marginLeft: 10, verticalAlign: 'middle' }}>🔒 {t('libTeamOnly')}</span> : null}</h1>
      <Flash error={e} />
      {isAudio(file.mime) ? (
        <audio className="audio-file" controls controlsList="nodownload" preload="metadata" src={signed.signedUrl} />
      ) : (
        <PdfViewer
          url={signed.signedUrl}
          footer={`LanHub${file.level ? ` · ${file.level}` : ''} · ${profile.viewer_code}`}
          labels={{ show: t('showMode'), exit: t('exitShow'), prev: t('pdfPrev'), next: t('pdfNext'), page: t('page'),
            fitPage: t('pdfFitPage'), fitWidth: t('pdfFitWidth'), zoomIn: t('pdfZoomIn'), zoomOut: t('pdfZoomOut'), goTo: t('pdfGoTo') }}
          audio={audio ? {
            ...audio,
            labels: {
              title: t('libAudio'), onPage: t('audOnPage'), none: t('audNone'), all: t('audAll'), page: t('audPage'),
              add: t('audAdd'), track: t('audTrack'), label: t('audLabel'), labelHint: t('audLabelHint'), remove: t('audRemove'),
            },
          } : undefined}
        />
      )}
    </Shell>
  );
}
