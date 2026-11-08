'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { canSendMail, sendInvite } from '@/lib/mail';
import { currentMonthStart } from '@/lib/i18n';
import { parseTeacherChoice } from '@/lib/invites';

// Refresh in place after a change (no jump to the top); errors come back in
// the address. go() is for actions that lead to another page.
function done(path: string, error?: string | null) {
  revalidatePath(path.split('?')[0]);
  if (error) redirect(`${path}${path.includes('?') ? '&' : '?'}e=${encodeURIComponent(error)}`);
}
function go(path: string, error?: string | null): never {
  revalidatePath(path.split('?')[0]);
  redirect(error ? `${path}${path.includes('?') ? '&' : '?'}e=${encodeURIComponent(error)}` : path);
}

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const optional = (f: FormData, k: string) => str(f, k) || null;

// A student's teacher, or an invited teacher who has not signed in yet.
function teacherFields(value: string) {
  const who = parseTeacherChoice(value);
  return { teacher_id: who.teacher ?? null, pending_teacher: who.invite ?? null };
}

export async function addStudent(f: FormData) {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from('students').insert({
    full_name: str(f, 'full_name'),
    level: optional(f, 'level'),
    market: str(f, 'market') === 'intl' ? 'intl' : 'ua',
    locale: 'en',
    ...teacherFields(str(f, 'teacher_id')),
    email: optional(f, 'email'),
    contact: optional(f, 'contact'),
  }).select('id').single();
  if (error) go('/school/students', error.message);
  go(`/school/students/${data!.id}`);
}

export async function updateStudent(f: FormData) {
  const id = str(f, 'id');
  const supabase = await supabaseServer();
  const { error } = await supabase.from('students').update({
    full_name: str(f, 'full_name'),
    level: optional(f, 'level'),
    market: str(f, 'market') === 'intl' ? 'intl' : 'ua',
    ...teacherFields(str(f, 'teacher_id')),
    email: optional(f, 'email'),
    contact: optional(f, 'contact'),
    status: str(f, 'status') || 'active',
    notes: optional(f, 'notes'),
  }).eq('id', id);
  done(`/school/students/${id}`, error?.message);
}

export async function addPackage(f: FormData) {
  const studentId = str(f, 'student_id');
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from('packages').insert({
    student_id: studentId,
    lessons_total: Number(str(f, 'lessons_total')),
    note: optional(f, 'note'),
  }).select('id').single();
  if (error) go(`/school/students/${studentId}`, error.message);
  const amount = str(f, 'amount');
  if (amount) {
    const { error: payError } = await supabase.from('student_payments').insert({
      package_id: data!.id, amount: Number(amount), currency: str(f, 'currency') || 'UAH', method: optional(f, 'method'),
    });
    if (payError) go(`/school/students/${studentId}`, payError.message);
  }
  done(`/school/students/${studentId}`);
}

// Only the owner deletes, and only a card without lessons: a student who has
// lessons stays in the history (status "left" hides them from the lists).
export async function deleteStudent(f: FormData) {
  const id = str(f, 'id');
  if (str(f, 'sure') !== '1') go(`/school/students/${id}`);
  const supabase = await supabaseServer();
  const { count } = await supabase.from('lessons').select('id', { count: 'exact', head: true }).eq('student_id', id);
  if (count) go(`/school/students/${id}`, 'HAS_LESSONS');
  const { data, error } = await supabase.from('students').delete().eq('id', id).select('id');
  if (error) go(`/school/students/${id}`, error.message);
  if (!data?.length) go(`/school/students/${id}`, 'Only the owner can delete a student');
  go('/school/students');
}

export async function extendPackage(f: FormData) {
  const studentId = str(f, 'student_id');
  const supabase = await supabaseServer();
  const { data: pkg } = await supabase.from('packages').select('extra_days').eq('id', str(f, 'package_id')).single();
  const { error } = await supabase.from('packages')
    .update({ extra_days: (pkg?.extra_days ?? 0) + Number(str(f, 'days') || 7) })
    .eq('id', str(f, 'package_id'));
  done(`/school/students/${studentId}`, error?.message);
}

export async function addAdjustment(f: FormData) {
  const month = str(f, 'month');
  const supabase = await supabaseServer();
  const { error } = await supabase.from('payout_adjustments').insert({
    teacher_id: str(f, 'teacher_id'), month, description: str(f, 'description'), amount: Number(str(f, 'amount')),
  });
  done(`/school/payouts?month=${month}`, error?.message);
}

export async function setPayoutStatus(f: FormData) {
  const month = str(f, 'month');
  const supabase = await supabaseServer();
  const { error } = await supabase.from('payout_reviews').upsert({
    teacher_id: str(f, 'teacher_id'), month, status: str(f, 'status'), updated_at: new Date().toISOString(),
  });
  done(`/school/payouts?month=${month}`, error?.message);
}

// Ready-made rate sets, matching the September 2026 list.
const TEMPLATES: Record<string, object[]> = {
  '400': [
    { kind: 'individual', band: 'A', amount: 400 },
    { kind: 'individual', band: 'B', amount: 420 },
    { kind: 'individual', band: 'B', package_lessons: 12, amount: 460 },
    { kind: 'trial', amount: 400 },
  ],
  '450': [
    { kind: 'individual', band: 'A', amount: 450 },
    { kind: 'individual', band: 'B', amount: 520 },
    { kind: 'trial', amount: 400 },
  ],
  '550': [
    { kind: 'individual', band: 'A', amount: 550 },
    { kind: 'individual', band: 'B', amount: 600 },
  ],
};

export async function invitePerson(f: FormData) {
  const supabase = await supabaseServer();
  const role = str(f, 'role');
  const teaches = role === 'teacher' || role === 'head_teacher';
  const email = str(f, 'email').toLowerCase();
  const locale = str(f, 'locale') === 'uk' ? 'uk' : 'en';
  const { error } = await supabase.from('invites').insert({
    email,
    full_name: str(f, 'full_name'),
    role,
    locale,
    pending_rates: teaches ? TEMPLATES[str(f, 'template')] ?? [] : [],
  });
  if (error) go('/school/team', error.message);
  if (canSendMail()) {
    const mailError = await sendInvite(email, str(f, 'full_name'), role, locale);
    if (mailError) go('/school/team', mailError);
    revalidatePath('/school/team');
    redirect('/school/team?ok=sent');
  }
  done('/school/team');
}

export async function resendInvite(f: FormData) {
  const supabase = await supabaseServer();
  const { data: inv } = await supabase.from('invites').select('email, full_name, role, locale')
    .eq('email', str(f, 'email')).is('accepted_at', null).maybeSingle();
  if (!inv) go('/school/team', 'No such invite');
  const mailError = await sendInvite(inv!.email, inv!.full_name, inv!.role, inv!.locale);
  if (mailError) done('/school/team', mailError);
  revalidatePath('/school/team');
  redirect('/school/team?ok=sent');
}

// "3:750, 4:900" -> steps from 3 present 750, from 4 present 900
function parseSteps(text: string) {
  return text.split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean).map((p) => {
    const [n, amount] = p.split(/[:=→\s]+/).map(Number);
    return { min_present: n, amount };
  }).filter((s) => Number.isInteger(s.min_present) && s.min_present > 1 && s.amount >= 0);
}

export async function addRate(f: FormData) {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from('teacher_rates').insert({
    teacher_id: str(f, 'teacher_id'),
    kind: str(f, 'kind'),
    band: optional(f, 'band'),
    market: optional(f, 'market'),
    package_lessons: str(f, 'package_lessons') ? Number(str(f, 'package_lessons')) : null,
    amount: Number(str(f, 'amount')),
    valid_from: str(f, 'valid_from') || new Date().toISOString().slice(0, 10),
  }).select('id').single();
  if (error) go('/school/team', error.message);
  const steps = parseSteps(str(f, 'steps'));
  if (steps.length) {
    const { error: e2 } = await supabase.from('rate_steps').insert(steps.map((s) => ({ ...s, rate_id: data!.id })));
    done('/school/team', e2?.message);
  }
  done('/school/team');
}

export async function addAllowance(f: FormData) {
  const supabase = await supabaseServer();
  const month = str(f, 'starts_on');
  const { error } = await supabase.from('teacher_allowances').insert({
    teacher_id: str(f, 'teacher_id'),
    label: str(f, 'label') || 'Zoom',
    amount: Number(str(f, 'amount')),
    currency: ['UAH', 'EUR', 'USD'].includes(str(f, 'currency')) ? str(f, 'currency') : 'UAH',
    starts_on: /^\d{4}-\d{2}$/.test(month) ? `${month}-01` : currentMonthStart(),
  });
  done('/school/team', error?.message);
}

// The current month still gets its line; from the next one it stops.
export async function endAllowance(f: FormData) {
  const supabase = await supabaseServer();
  const { error } = await supabase.from('teacher_allowances').update({ ends_on: currentMonthStart() }).eq('id', str(f, 'id'));
  done('/school/team', error?.message);
}

export async function setActive(f: FormData) {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc('set_profile_active', { target: str(f, 'id'), is_active: str(f, 'active') === 'true' });
  done('/school/team', error?.message);
}

export async function addGroup(f: FormData) {
  const supabase = await supabaseServer();
  const { error } = await supabase.from('groups').insert({
    name: str(f, 'name'), level: optional(f, 'level'), kind: str(f, 'kind') || 'group', teacher_id: optional(f, 'teacher_id'),
  });
  done('/school/students', error?.message);
}

export async function addToGroup(f: FormData) {
  const studentId = str(f, 'student_id');
  const supabase = await supabaseServer();
  const { error } = await supabase.from('group_members').insert({ group_id: str(f, 'group_id'), student_id: studentId });
  done(`/school/students/${studentId}`, error?.message);
}
