'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { canSendMail, sendInvite } from '@/lib/mail';

function done(path: string, error?: string | null) {
  revalidatePath(path);
  redirect(error ? `${path}${path.includes('?') ? '&' : '?'}e=${encodeURIComponent(error)}` : path);
}

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const optional = (f: FormData, k: string) => str(f, k) || null;

export async function addStudent(f: FormData) {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from('students').insert({
    full_name: str(f, 'full_name'),
    level: optional(f, 'level'),
    market: str(f, 'market') === 'intl' ? 'intl' : 'ua',
    locale: 'en',
    teacher_id: optional(f, 'teacher_id'),
    email: optional(f, 'email'),
    contact: optional(f, 'contact'),
  }).select('id').single();
  if (error) done('/school/students', error.message);
  done(`/school/students/${data!.id}`);
}

export async function updateStudent(f: FormData) {
  const id = str(f, 'id');
  const supabase = await supabaseServer();
  const { error } = await supabase.from('students').update({
    full_name: str(f, 'full_name'),
    level: optional(f, 'level'),
    market: str(f, 'market') === 'intl' ? 'intl' : 'ua',
    teacher_id: optional(f, 'teacher_id'),
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
  if (error) done(`/school/students/${studentId}`, error.message);
  const amount = str(f, 'amount');
  if (amount) {
    const { error: payError } = await supabase.from('student_payments').insert({
      package_id: data!.id, amount: Number(amount), currency: str(f, 'currency') || 'UAH', method: optional(f, 'method'),
    });
    if (payError) done(`/school/students/${studentId}`, payError.message);
  }
  done(`/school/students/${studentId}`);
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
  if (error) done('/school/team', error.message);
  if (canSendMail()) {
    const mailError = await sendInvite(email, str(f, 'full_name'), role, locale);
    if (mailError) done('/school/team', mailError);
    revalidatePath('/school/team');
    redirect('/school/team?ok=sent');
  }
  done('/school/team');
}

export async function resendInvite(f: FormData) {
  const supabase = await supabaseServer();
  const { data: inv } = await supabase.from('invites').select('email, full_name, role, locale')
    .eq('email', str(f, 'email')).is('accepted_at', null).maybeSingle();
  if (!inv) done('/school/team', 'No such invite');
  const mailError = await sendInvite(inv!.email, inv!.full_name, inv!.role, inv!.locale);
  if (mailError) done('/school/team', mailError);
  revalidatePath('/school/team');
  redirect('/school/team?ok=sent');
}

export async function addRate(f: FormData) {
  const supabase = await supabaseServer();
  const { error } = await supabase.from('teacher_rates').insert({
    teacher_id: str(f, 'teacher_id'),
    kind: str(f, 'kind'),
    band: optional(f, 'band'),
    market: optional(f, 'market'),
    package_lessons: str(f, 'package_lessons') ? Number(str(f, 'package_lessons')) : null,
    amount: Number(str(f, 'amount')),
    valid_from: str(f, 'valid_from') || new Date().toISOString().slice(0, 10),
  });
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
