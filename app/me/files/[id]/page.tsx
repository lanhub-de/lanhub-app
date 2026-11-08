import { notFound } from 'next/navigation';
import Shell from '@/components/Shell';
import PdfViewer from '@/components/PdfViewer';
import { requireProfile } from '@/lib/session';

// A course guide or lesson file for a student: view only; the link lasts a
// lesson (pages load as they are turned), then stops working.
export default async function MyFile({ params }: { params: Promise<{ id: string }> }) {
  const { supabase, profile, t } = await requireProfile(['student']);
  const { id } = await params;
  const { data: file } = await supabase.from('files').select('id, title, level, storage_path').eq('id', id).maybeSingle();
  if (!file) notFound();
  const { data: signed } = await supabase.storage.from('files').createSignedUrl(file.storage_path, 3 * 60 * 60);
  if (!signed?.signedUrl) notFound();
  await supabase.from('file_access_log').insert({ file_id: file.id, profile_id: profile.id });
  return (
    <Shell profile={profile} t={t} active="/me">
      <h1>{file.title}</h1>
      <PdfViewer
        url={signed.signedUrl}
        footer={`LanHub${file.level ? ` · ${file.level}` : ''} · ${profile.viewer_code}`}
        labels={{ show: t('showMode'), exit: t('exitShow'), prev: t('prev'), next: t('next'), page: t('page') }}
      />
    </Shell>
  );
}
