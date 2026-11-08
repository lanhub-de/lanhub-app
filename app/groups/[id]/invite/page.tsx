import Link from 'next/link';
import { notFound } from 'next/navigation';
import Shell, { Flash } from '@/components/Shell';
import Submit from '@/components/Submit';
import { requireProfile } from '@/lib/session';
import { fmtDate } from '@/lib/i18n';
import { inviteGroup } from '@/app/teacher/actions';

type Row = { student_id: string; students: { id: string; full_name: string; email: string | null; locale: string | null; invited_at: string | null; profile_id: string | null; market: string | null } | null };

// Invite the whole group to LanHub at once: an email per student, the
// language of the letter, and who is already in.
export default async function InviteGroup({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ e?: string; sent?: string }>;
}) {
  const { supabase, profile, t } = await requireProfile(['owner', 'head_teacher', 'manager', 'teacher']);
  const { id } = await params;
  const sp = await searchParams;
  const [{ data: g }, { data: rows }] = await Promise.all([
    supabase.from('groups').select('id, name').eq('id', id).maybeSingle(),
    supabase.from('group_members').select('student_id, students(id, full_name, email, locale, invited_at, profile_id, market)').eq('group_id', id).returns<Row[]>(),
  ]);
  if (!g) notFound();
  const members = (rows ?? []).filter((r) => r.students).map((r) => r.students!).sort((a, b) => a.full_name.localeCompare(b.full_name));
  const joined = members.filter((m) => m.profile_id).length;
  const here = `/groups/${id}/invite`;
  return (
    <Shell profile={profile} t={t} active={profile.role === 'teacher' ? '/teacher' : '/school/groups'}>
      <p style={{ marginTop: 0 }}><Link href={`/groups/${id}`}>← {g.name}</Link></p>
      <h1 style={{ marginBottom: 4 }}>{t('inviteGroupTitle')}</h1>
      <p className="muted" style={{ marginTop: 0 }}>{t('inviteGroupHint', { n: joined, m: members.length })}</p>
      <Flash ok={sp.sent ? t('inviteSentN', { n: sp.sent }) : undefined} error={sp.e} />
      <form action={inviteGroup} className="card">
        <input type="hidden" name="return_to" value={here} />
        <div className="invite-rows">
          {members.map((m) => (
            <div key={m.id} className="invite-row">
              <strong>{m.full_name}</strong>
              {m.profile_id ? (
                <span className="pill ok">✓ {t('inviteJoined')}</span>
              ) : (
                <>
                  <input type="hidden" name="student_id" value={m.id} />
                  <input type="hidden" name={`name_${m.id}`} value={m.full_name} />
                  {m.invited_at && <input type="hidden" name={`was_${m.id}`} value="1" />}
                  <input type="email" name={`email_${m.id}`} defaultValue={m.email ?? ''} placeholder="name@gmail.com" aria-label={`${t('emailLabel')}: ${m.full_name}`} />
                  <select name={`locale_${m.id}`} defaultValue={m.locale === 'en' || m.market === 'intl' ? 'en' : 'uk'} aria-label={t('inviteLang')}>
                    <option value="uk">UA</option>
                    <option value="en">EN</option>
                  </select>
                  {m.invited_at ? (
                    <label className="invite-again"><input type="checkbox" name={`again_${m.id}`} /> {t('inviteSentShort', { date: fmtDate(m.invited_at, profile.locale) })} · {t('inviteAgainShort')}</label>
                  ) : <span />}
                </>
              )}
            </div>
          ))}
        </div>
        {members.length === 0 && <p className="muted">{t('nothingHere')}</p>}
        <div className="row" style={{ marginTop: 14 }}>
          <Submit className="primary">{t('inviteSendAll')}</Submit>
          <small className="muted">{t('inviteGroupNote')}</small>
        </div>
      </form>
    </Shell>
  );
}
