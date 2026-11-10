import Link from 'next/link';
import { notFound } from 'next/navigation';
import Shell from '@/components/Shell';
import PdfViewer from '@/components/PdfViewer';
import { requireProfile, TEACHING } from '@/lib/session';
import { isAudio } from '@/lib/library';

export default async function ViewFile({ params }: { params: Promise<{ id: string }> }) {
  const { supabase, profile, t } = await requireProfile(TEACHING);
  const { id } = await params;
  const { data: file } = await supabase.from('files')
    .select('id, title, level, storage_path, mime, folder_id, staff_only').eq('id', id).maybeSingle();
  if (!file) notFound();
  // The link lasts a lesson (pages load as they are turned), then stops working.
  const { data: signed } = await supabase.storage.from('files').createSignedUrl(file.storage_path, 3 * 60 * 60);
  if (!signed?.signedUrl) notFound();
  await supabase.from('file_access_log').insert({ file_id: file.id, profile_id: profile.id });
  const { data: folder } = file.folder_id
    ? await supabase.from('library_folders').select('id, name').eq('id', file.folder_id).maybeSingle()
    : { data: null };

  return (
    <Shell profile={profile} t={t} active="/library">
      <p><Link href={folder ? `/library?f=${folder.id}` : '/library'}>← {folder?.name ?? t('library')}</Link></p>
      <h1>{file.title}{file.staff_only ? <span className="pill" style={{ marginLeft: 10, verticalAlign: 'middle' }}>🔒 {t('libTeamOnly')}</span> : null}</h1>
      {isAudio(file.mime) ? (
        <audio className="audio-file" controls controlsList="nodownload" preload="metadata" src={signed.signedUrl} />
      ) : (
        <PdfViewer
          url={signed.signedUrl}
          footer={`LanHub${file.level ? ` · ${file.level}` : ''} · ${profile.viewer_code}`}
          labels={{ show: t('showMode'), exit: t('exitShow'), prev: t('pdfPrev'), next: t('pdfNext'), page: t('page'),
            fitPage: t('pdfFitPage'), fitWidth: t('pdfFitWidth'), zoomIn: t('pdfZoomIn'), zoomOut: t('pdfZoomOut') }}
        />
      )}
    </Shell>
  );
}
