import Link from 'next/link';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { T } from './i18n';
import { INVITE, pendingTeachers } from './invites';

export type Whose = { id: string; pending: string | null; name: string; viewing: boolean };

// Whose cabinet this is: your own, or, for the owner and the head teacher,
// any teacher's (?as=<profile id>) or an invited one's (?as=invite:<email>),
// shown exactly as she will see it.
export async function whoseCabinet(
  supabase: SupabaseClient, me: { id: string; full_name: string; role: string }, as?: string,
): Promise<Whose> {
  const own = { id: me.id, pending: null, name: me.full_name, viewing: false };
  if (!as || !(me.role === 'owner' || me.role === 'head_teacher')) return own;
  if (as.startsWith(INVITE)) {
    const email = as.slice(INVITE.length);
    const { data: name } = await supabase.rpc('pending_name', { e: email });
    return { id: me.id, pending: email, name: (name as string | null) ?? email, viewing: true };
  }
  const { data: p } = await supabase.from('profiles').select('id, full_name, role').eq('id', as).maybeSingle();
  if (!p || !['teacher', 'head_teacher', 'owner'].includes(p.role)) return own;
  return { id: p.id, pending: null, name: p.full_name, viewing: p.id !== me.id };
}

export const asParam = (w: Whose) => (w.viewing ? `as=${encodeURIComponent(w.pending ? `${INVITE}${w.pending}` : w.id)}` : '');

// Filters a lessons, groups or group_overview query to this teacher's rows
// (rows waiting for an invited teacher carry her email instead).
export function onlyTheirs<Q>(w: Whose, q: Q): Q {
  type F = { eq: (c: string, v: string) => F; is: (c: string, v: null) => F };
  const f = q as unknown as F;
  return (w.pending ? f.eq('pending_teacher', w.pending) : f.eq('teacher_id', w.id).is('pending_teacher', null)) as unknown as Q;
}

// The row of cabinets the owner and head teacher can switch between.
export async function CabinetSwitch({
  supabase, me, who, base, t,
}: { supabase: SupabaseClient; me: { id: string; role: string }; who: Whose; base: string; t: T }) {
  if (!(me.role === 'owner' || me.role === 'head_teacher')) return null;
  const [{ data: teachers }, invited] = await Promise.all([
    supabase.from('profiles').select('id, full_name').in('role', ['teacher', 'head_teacher']).eq('active', true).order('full_name'),
    me.role === 'owner' ? pendingTeachers(supabase) : Promise.resolve([]),
  ]);
  return (
    <div className="cabinet-switch">
      <span className="muted">{t('cabinetOf')}</span>
      <Link href={base} className={!who.viewing ? 'active' : ''}>{t('cabinetMine')}</Link>
      {(teachers ?? []).filter((p) => p.id !== me.id).map((p) => (
        <Link key={p.id} href={`${base}?as=${p.id}`} className={who.viewing && !who.pending && who.id === p.id ? 'active' : ''}>{p.full_name}</Link>
      ))}
      {invited.map((i) => (
        <Link key={i.email} href={`${base}?as=${encodeURIComponent(`${INVITE}${i.email}`)}`}
          className={who.pending === i.email ? 'active' : ''}>{i.full_name} · {t('pending')}</Link>
      ))}
    </div>
  );
}
