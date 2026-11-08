import Link from 'next/link';
import { notFound } from 'next/navigation';
import Shell, { Flash } from '@/components/Shell';
import Submit from '@/components/Submit';
import { requireProfile } from '@/lib/session';
import { fmtDate } from '@/lib/i18n';
import { splitStudentName } from '@/lib/names';
import { inviteGroup } from '@/app/teacher/actions';

type Student = { id: string; full_name: string; contact: string | null; email: string | null; locale: string | null; invited_at: string | null; profile_id: string | null; market: string | null };
type Row = { student_id: string; students: Student | null };

// Invite the whole group to LanHub at once: each student's real name (instead
// of an Instagram nickname), email and the language of the letter, and who is
// already in.
export default async function InviteGroup({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ e?: string; sent?: string; named?: string }>;
}) {
  const { supabase, profile, t } = await requireProfile(['owner', 'head_teacher', 'manager', 'teacher']);
  const { id } = await params;
  const sp = await searchParams;
  const [{ data: g }, { data: rows }] = await Promise.all([
    supabase.from('groups').select('id, name').eq('id', id).maybeSingle(),
    supabase.from('group_members').select('student_id, students(id, full_name, contact, email, locale, invited_at, profile_id, market)')
      .eq('group_id', id).returns<Row[]>(),
  ]);
  if (!g) notFound();
  const members = (rows ?? []).filter((r) => r.students).map((r) => r.students!).sort((a, b) => a.full_name.localeCompare(b.full_name));
  const joined = members.filter((m) => m.profile_id).length;
  const here = `/groups/${id}/invite`;
  const ok = [
    Number(sp.named) ? t('namesSavedN', { n: sp.named! }) : null,
    Number(sp.sent) ? t('inviteSentN', { n: sp.sent! }) : null,
  ].filter(Boolean).join(' · ');
  return (
    <Shell profile={profile} t={t} active={profile.role === 'teacher' ? '/teacher' : '/school/groups'}>
      <p style={{ marginTop: 0 }}><Link href={`/groups/${id}`}>← {g.name}</Link></p>
      <h1 style={{ marginBottom: 4 }}>{t('inviteGroupTitle')}</h1>
      <p className="muted" style={{ marginTop: 0 }}>{t('inviteGroupHint', { n: joined, m: members.length })}</p>
      <Flash ok={ok || undefined} error={sp.e} />
      <form action={inviteGroup} className="card">
        <input type="hidden" name="return_to" value={here} />
        <input type="hidden" name="need_name" value={t('needFirstName')} />
        <div className="invite-rows">
          {members.map((m) => {
            const n = splitStudentName(m.full_name, m.contact);
            return (
              <div key={m.id} className="invite-row">
                <div className="invite-who">
                  <strong>{m.full_name}</strong>
                  {n.handle && !n.nick && <span className="muted">@{n.handle}</span>}
                  {m.profile_id
                    ? <span className="pill ok">✓ {t('inviteJoined')}</span>
                    : m.invited_at ? <span className="pill warn">{t('inviteSentShort', { date: fmtDate(m.invited_at, profile.locale) })}</span> : null}
                </div>
                <input type="hidden" name="student_id" value={m.id} />
                <input type="hidden" name={`name_${m.id}`} value={m.full_name} />
                {n.nick && <input type="hidden" name={`nick_${m.id}`} value="1" />}
                <input name={`first_${m.id}`} defaultValue={n.first} placeholder={t('firstName')} aria-label={`${t('firstName')}: ${m.full_name}`} />
                <input name={`last_${m.id}`} defaultValue={n.last} placeholder={t('lastName')} aria-label={`${t('lastName')}: ${m.full_name}`} />
                {m.profile_id ? <span className="invite-span muted">{m.email}</span> : (
                  <>
                    {m.invited_at && <input type="hidden" name={`was_${m.id}`} value="1" />}
                    <input type="email" name={`email_${m.id}`} defaultValue={m.email ?? ''} placeholder="name@gmail.com" aria-label={`${t('emailLabel')}: ${m.full_name}`} />
                    <select name={`locale_${m.id}`} defaultValue={m.locale === 'en' || m.market === 'intl' ? 'en' : 'uk'} aria-label={t('inviteLang')}>
                      <option value="uk">UA</option>
                      <option value="en">EN</option>
                    </select>
                    {m.invited_at && (
                      <label className="invite-again"><input type="checkbox" name={`again_${m.id}`} /> {t('inviteAgainShort')}</label>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
        {members.length === 0 && <p className="muted">{t('nothingHere')}</p>}
        <div className="row" style={{ marginTop: 14 }}>
          <Submit className="primary">{t('inviteSaveSend')}</Submit>
          <small className="muted">{t('inviteGroupNote')}</small>
        </div>
      </form>
    </Shell>
  );
}
