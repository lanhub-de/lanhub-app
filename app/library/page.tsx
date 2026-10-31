import Link from 'next/link';
import Shell, { Flash } from '@/components/Shell';
import UploadForm from '@/components/UploadForm';
import { requireProfile, TEACHING } from '@/lib/session';

export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const { supabase, profile, t } = await requireProfile(TEACHING);
  const sp = await searchParams;
  const { data: files } = await supabase.from('files')
    .select('id, title, level, visibility, uploaded_by, created_at').order('title');
  const library = (files ?? []).filter((f) => f.visibility === 'library');
  const mine = (files ?? []).filter((f) => f.visibility === 'private' && f.uploaded_by === profile.id);
  const canPublish = profile.role === 'owner' || profile.role === 'head_teacher';

  return (
    <Shell profile={profile} t={t} active="/library">
      <h1>{t('library')}</h1>
      <p className="muted">{t('viewOnly')}</p>
      <Flash error={sp.e} ok={sp.ok ? t('saved') : undefined} />
      <div className="grid" style={{ alignItems: 'start' }}>
        <section className="card" style={{ gridColumn: 'span 2' }}>
          {library.length === 0 && <p className="muted">{t('nothingHere')}</p>}
          {library.map((f) => (
            <div key={f.id} className="spread" style={{ padding: '10px 0', borderBottom: '1px solid var(--sand)' }}>
              <span>{f.title}{f.level ? <span className="muted"> · {f.level}</span> : null}</span>
              <Link href={`/library/${f.id}`} className="btn small">{t('open')}</Link>
            </div>
          ))}
          {mine.length > 0 && (
            <>
              <h2 style={{ marginTop: 16 }}>{t('file')} · {profile.full_name}</h2>
              {mine.map((f) => (
                <div key={f.id} className="spread" style={{ padding: '10px 0', borderBottom: '1px solid var(--sand)' }}>
                  <span>{f.title}</span>
                  <Link href={`/library/${f.id}`} className="btn small">{t('open')}</Link>
                </div>
              ))}
            </>
          )}
        </section>
        <aside className="card">
          <h2>{t('upload')}</h2>
          <UploadForm
            userId={profile.id}
            canPublish={canPublish}
            labels={{ title: t('title'), level: t('level'), file: t('file'), upload: t('upload'), library: t('library') }}
          />
        </aside>
      </div>
    </Shell>
  );
}
