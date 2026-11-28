'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { canSendMail, sendInvite } from '@/lib/mail';
import { currentMonthStart, kyivLocalToIso } from '@/lib/i18n';
import { parseTeacherChoice } from '@/lib/invites';
import { cleanInstagram } from '@/lib/instagram';

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

// The Instagram nickname lives apart from the card teachers read (owner and managers only).
// Not in the form: left as it is; empty: removed.
async function setInstagram(supabase: Awaited<ReturnType<typeof supabaseServer>>, studentId: string, f: FormData) {
  if (!f.has('instagram')) return null;
  const handle = cleanInstagram(str(f, 'instagram'));
  const { error } = handle
    ? await supabase.from('student_instagram').upsert({ student_id: studentId, handle, updated_at: new Date().toISOString() })
    : await supabase.from('student_instagram').delete().eq('student_id', studentId);
  return error?.message ?? null;
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
  go(`/school/students/${data!.id}`, await setInstagram(supabase, data!.id, f));
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
  done(`/school/students/${id}`, error?.message ?? await setInstagram(supabase, id, f));
}

// A diagnostic lesson for a teacher, booked by the school. A new person gets
// her card here (no teacher assigned yet: that is decided after the
// diagnostic). The teacher sees the lesson in her schedule and is paid the
// school's flat amount once it is marked held.
export async function addDiagnostic(f: FormData) {
  const local = str(f, 'starts_at');
  const teacherId = str(f, 'teacher_id');
  // back to where the form was, or to the journal on that teacher and month
  const returnTo = str(f, 'return_to')
    || `/school/lessons?month=${/^\d{4}-\d{2}/.test(local) ? local.slice(0, 7) : currentMonthStart().slice(0, 7)}-01${teacherId ? `&teacher=${teacherId}` : ''}`;
  if (!teacherId) go(returnTo, 'Choose the teacher');
  const startsAt = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(local) ? kyivLocalToIso(local.slice(0, 16)) : '';
  if (!startsAt || Number.isNaN(new Date(startsAt).getTime())) go(returnTo, 'Check the date and time');
  const minutes = Number(str(f, 'duration_min') || 60);
  const supabase = await supabaseServer();
  let studentId = str(f, 'student_id');
  if (!studentId) {
    const name = str(f, 'full_name');
    if (!name) go(returnTo, 'Choose a student or type the new student’s name');
    const intl = str(f, 'market') === 'intl';
    const { data, error } = await supabase.from('students').insert({
      full_name: name, level: optional(f, 'level'), market: intl ? 'intl' : 'ua', locale: intl ? 'en' : 'uk',
      contact: optional(f, 'contact'),
    }).select('id').single();
    if (error || !data) go(returnTo, error?.message ?? 'The student was not added');
    studentId = data!.id;
    const igErr = await setInstagram(supabase, studentId, f);
    if (igErr) go(returnTo, igErr);
  }
  const { error } = await supabase.from('lessons').insert({
    teacher_id: teacherId, student_id: studentId, kind: 'diagnostic', starts_at: startsAt,
    duration_min: [30, 45, 60, 75, 90].includes(minutes) ? minutes : 60,
    zoom_url: optional(f, 'zoom_url'), note: (optional(f, 'note') ?? '').slice(0, 300) || null,
  });
  go(returnTo, error?.message);
}

// "Not continuing" / "paused" / back to active: for a student whose package is
// over (or who did not buy after a diagnostic). A paused or gone student
// leaves the to-do lists and her teacher's cabinet; her card, lessons and
// payments stay. "Not continuing" needs the reason.
export async function setStudentStatus(f: FormData) {
  const id = str(f, 'id');
  const status = str(f, 'status');
  const returnTo = str(f, 'return_to') || `/school/students/${id}`;
  if (!['active', 'paused', 'left'].includes(status)) go(returnTo, 'Unknown status');
  const reason = str(f, 'left_reason');
  if (status === 'left' && f.has('left_reason') && !reason) go(returnTo, 'WHY_NEEDED');
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from('students').update(
    status === 'left'
      ? { status, left_reason: reason || null, left_note: optional(f, 'left_note'), left_at: new Date().toISOString() }
      : status === 'active' ? { status, left_reason: null, left_note: null, left_at: null } : { status },
  ).eq('id', id).select('id');
  done(returnTo, error?.message ?? (data?.length ? null : 'Not saved'));
}

// A manager's mark on a task: "wrote to her" (comes back in a few days if
// nothing changes) or "done" (feedback received: gone for good).
export async function markTask(f: FormData) {
  const returnTo = str(f, 'return_to') || '/school/today';
  const kind = str(f, 'kind');
  const remind = str(f, 'mode') === 'remind';
  const supabase = await supabaseServer();
  const { error } = await supabase.from('manager_marks').upsert({
    kind, ref: str(f, 'ref'), student_id: str(f, 'student_id'),
    remind_at: remind ? new Date(Date.now() + 3 * 864e5).toISOString() : null,
  }, { onConflict: 'kind,ref' });
  done(returnTo, error?.message);
}

// The student paid (the rest of) a package: how many lessons it covers, and the sum if known.
export async function recordPayment(f: FormData) {
  const studentId = str(f, 'student_id');
  const packageId = str(f, 'package_id');
  const returnTo = str(f, 'return_to') || `/school/students/${studentId}`;
  const supabase = await supabaseServer();
  const { data: pkg } = await supabase.from('packages').select('lessons_total, paid_lessons').eq('id', packageId).single();
  if (!pkg) go(returnTo, 'No such package');
  const lessons = Math.round(Number(str(f, 'lessons') || 0));
  const paidNow = pkg!.paid_lessons ?? pkg!.lessons_total;
  const paid = Math.min(pkg!.lessons_total, (pkg!.paid_lessons ?? 0) + (lessons > 0 ? lessons : pkg!.lessons_total - paidNow));
  const { error } = await supabase.from('packages')
    .update({ paid_lessons: paid >= pkg!.lessons_total ? null : paid }).eq('id', packageId);
  if (error) go(returnTo, error.message);
  const amount = str(f, 'amount');
  if (amount) {
    const { error: payError } = await supabase.from('student_payments').insert({
      package_id: packageId, amount: Number(amount), currency: str(f, 'currency') || 'UAH', method: optional(f, 'method'),
      paid_at: /^\d{4}-\d{2}-\d{2}$/.test(str(f, 'paid_at')) ? str(f, 'paid_at') : undefined,
    });
    if (payError) go(returnTo, payError.message);
  }
  done(returnTo);
}

// Package fields from a form: lessons, months, a note and how much is paid now.
function packageFields(f: FormData) {
  const lessons = Math.round(Number(str(f, 'lessons_total') === 'other' ? str(f, 'lessons_custom') : str(f, 'lessons_total')));
  const months = Math.round(Number(str(f, 'validity_months') || 1));
  const paid = Math.round(Number(str(f, 'paid_lessons') || 0));
  return {
    lessons,
    row: {
      lessons_total: lessons,
      validity_months: months >= 1 && months <= 24 ? months : 1,
      note: optional(f, 'note'),
      paid_lessons: str(f, 'pay') === 'parts' && paid > 0 && paid < lessons ? paid : null,
    },
  };
}

async function addPayment(supabase: Awaited<ReturnType<typeof supabaseServer>>, f: FormData, packageId: string) {
  const amount = str(f, 'amount');
  if (!amount) return null;
  const { error } = await supabase.from('student_payments').insert({
    package_id: packageId, amount: Number(amount), currency: str(f, 'currency') || 'UAH', method: optional(f, 'method'),
    paid_at: /^\d{4}-\d{2}-\d{2}$/.test(str(f, 'paid_at')) ? str(f, 'paid_at') : undefined,
  });
  return error?.message ?? null;
}

// A new student with her teacher, and her first package and payment if she has bought one.
export async function addStudentFull(f: FormData) {
  const supabase = await supabaseServer();
  const back = `/school/new${str(f, 'teacher_id') ? `?teacher=${encodeURIComponent(str(f, 'teacher_id'))}` : ''}`;
  const name = str(f, 'full_name');
  if (!name) go(back, 'Type the name');
  const { data, error } = await supabase.from('students').insert({
    full_name: name,
    level: optional(f, 'level'),
    market: str(f, 'market') === 'intl' ? 'intl' : 'ua',
    locale: str(f, 'market') === 'intl' ? 'en' : 'uk',
    ...teacherFields(str(f, 'teacher_id')),
    email: optional(f, 'email'),
    contact: optional(f, 'contact'),
    schedule_note: optional(f, 'schedule_note'),
  }).select('id').single();
  if (error || !data) go(back, error?.message ?? 'Not saved');
  const id = data!.id;
  const igErr = await setInstagram(supabase, id, f);
  if (igErr) go(`/school/students/${id}`, igErr);
  if (str(f, 'lessons_total')) {
    const { lessons, row } = packageFields(f);
    if (!Number.isFinite(lessons) || lessons < 1 || lessons > 200) go(`/school/students/${id}`, 'Check the number of lessons');
    const { data: pkg, error: pErr } = await supabase.from('packages').insert({ student_id: id, ...row }).select('id').single();
    if (pErr || !pkg) go(`/school/students/${id}`, pErr?.message ?? 'The package was not added');
    const payErr = await addPayment(supabase, f, pkg!.id);
    if (payErr) go(`/school/students/${id}`, payErr);
  }
  go(`/school/students/${id}`);
}

export async function addPackage(f: FormData) {
  const studentId = str(f, 'student_id');
  const returnTo = str(f, 'return_to') || `/school/students/${studentId}`;
  const supabase = await supabaseServer();
  const { lessons, row } = packageFields(f);
  if (!Number.isFinite(lessons) || lessons < 1 || lessons > 200) go(returnTo, 'Check the number of lessons');
  // after a diagnostic the student gets her teacher together with the package
  if (str(f, 'teacher_id')) {
    const { error: tErr } = await supabase.from('students').update(teacherFields(str(f, 'teacher_id'))).eq('id', studentId);
    if (tErr) go(returnTo, tErr.message);
  }
  const { data, error } = await supabase.from('packages').insert({ student_id: studentId, ...row }).select('id').single();
  if (error) go(returnTo, error.message);
  // payments: the owner and managers (the head teacher has no payment fields)
  const payErr = await addPayment(supabase, f, data!.id);
  if (payErr) go(returnTo, payErr);
  done(returnTo);
}

// Fix a package: number of lessons, how long it lasts, its status and a note.
export async function updatePackage(f: FormData) {
  const studentId = str(f, 'student_id');
  const lessons = Math.round(Number(str(f, 'lessons_total')));
  const months = Math.round(Number(str(f, 'validity_months')));
  const status = str(f, 'status');
  if (!Number.isFinite(lessons) || lessons < 1 || lessons > 200) go(`/school/students/${studentId}`, 'Check the number of lessons');
  const supabase = await supabaseServer();
  const { error } = await supabase.from('packages').update({
    lessons_total: lessons,
    validity_months: months >= 1 && months <= 24 ? months : 1,
    status: ['active', 'finished', 'cancelled'].includes(status) ? status : 'active',
    note: optional(f, 'note'),
    // paid in parts: how many lessons are paid so far (empty or all = paid in full); owner and managers only
    ...(f.has('paid_lessons') ? (() => {
      const paid = Math.round(Number(str(f, 'paid_lessons') || 0));
      return { paid_lessons: paid > 0 && paid < lessons ? paid : null };
    })() : {}),
  }).eq('id', str(f, 'package_id'));
  done(`/school/students/${studentId}`, error?.message);
}

// The owner and managers delete, and only a card without lessons: a student who has
// lessons stays in the history (status "left" hides them from the lists).
export async function deleteStudent(f: FormData) {
  const id = str(f, 'id');
  if (str(f, 'sure') !== '1') go(`/school/students/${id}`);
  const supabase = await supabaseServer();
  const { count } = await supabase.from('lessons').select('id', { count: 'exact', head: true }).eq('student_id', id);
  if (count) go(`/school/students/${id}`, 'HAS_LESSONS');
  const { data, error } = await supabase.from('students').delete().eq('id', id).select('id');
  if (error) go(`/school/students/${id}`, error.message);
  if (!data?.length) go(`/school/students/${id}`, 'HAS_LESSONS');
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

// Removes a one-off extra line (a manual one or a renewal bonus).
export async function deleteAdjustment(f: FormData) {
  const month = str(f, 'month');
  const supabase = await supabaseServer();
  const { error } = await supabase.from('payout_adjustments').delete().eq('id', str(f, 'id')).is('allowance_id', null);
  done(`/school/payouts?month=${month}&open=${str(f, 'teacher_id')}`, error?.message);
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
