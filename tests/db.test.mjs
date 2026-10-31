// Runs the real migration in an in-memory Postgres and checks the business
// rules and the access rules for every role.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const ids = {};

// Supabase provides these; the stub mimics them for tests.
const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
  create table storage.objects (bucket_id text, name text, owner uuid);
  alter table storage.objects enable row level security;
  grant usage on schema auth to authenticated, anon;
  grant execute on function auth.uid() to authenticated, anon;
`;

async function as(uid, fn) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('test.uid', $1, true)`, [uid]);
    await tx.exec('set local role authenticated');
    return fn(tx);
  });
}

async function rows(uid, sql, params = []) {
  return as(uid, async (tx) => (await tx.query(sql, params)).rows);
}

async function fails(uid, sql, params = []) {
  try {
    await as(uid, (tx) => tx.query(sql, params));
  } catch (e) {
    return e.message;
  }
  return null;
}

async function person(key, name, role) {
  const { rows: [r] } = await db.query('select gen_random_uuid() as id');
  ids[key] = r.id;
  await db.query('insert into auth.users (id) values ($1)', [r.id]);
  await db.query(
    'insert into public.profiles (id, full_name, email, role) values ($1, $2, $3, $4)',
    [r.id, name, `${key}@lanhub.test`, role],
  );
}

before(async () => {
  await db.exec(SUPABASE_STUB);
  for (const f of readdirSync('supabase/migrations').sort()) {
    await db.exec(readFileSync(`supabase/migrations/${f}`, 'utf8'));
  }

  await person('owner', 'Юліанна', 'owner');
  await person('agata', 'Агата', 'head_teacher');
  await person('manager', 'Анастасія', 'manager');
  await person('nadiia', 'Надія', 'teacher');
  await person('toma', 'Тома', 'teacher');

  // June rates
  await db.query(`insert into public.teacher_rates (teacher_id, kind, band, amount, valid_from) values
    ($1, 'individual', 'A', 400, '2026-01-01'), ($1, 'individual', 'B', 420, '2026-01-01'),
    ($1, 'trial', null, 400, '2026-01-01'),
    ($2, 'individual', 'A', 450, '2026-01-01'), ($2, 'individual', 'B', 520, '2026-01-01')`,
    [ids.nadiia, ids.toma]);
});

test('migration created viewer codes for every person', async () => {
  const r = await db.query('select viewer_code from public.profiles order by viewer_code');
  assert.deepEqual(r.rows.map((x) => x.viewer_code), ['LH-01', 'LH-02', 'LH-03', 'LH-04', 'LH-05']);
});

test('manager adds students, packages and payments', async () => {
  const [lina] = await rows(ids.manager,
    `insert into public.students (full_name, level, teacher_id) values ('Ліна', 'B1', $1) returning id`,
    [ids.nadiia]);
  const [maksym] = await rows(ids.manager,
    `insert into public.students (full_name, level, teacher_id) values ('Максим', 'B1', $1) returning id`,
    [ids.toma]);
  ids.lina = lina.id;
  ids.maksym = maksym.id;
  const [pkg] = await rows(ids.manager,
    `insert into public.packages (student_id, lessons_total) values ($1, 4) returning id`, [ids.lina]);
  ids.linaPkg = pkg.id;
  await rows(ids.manager,
    `insert into public.student_payments (package_id, amount, method) values ($1, 1800, 'WayForPay')`,
    [ids.linaPkg]);
  await rows(ids.manager,
    `insert into public.packages (student_id, lessons_total) values ($1, 8)`, [ids.maksym]);
});

test('manager cannot see teacher rates', async () => {
  assert.equal((await rows(ids.manager, 'select * from public.teacher_rates')).length, 0);
});

test('teacher sees only own students', async () => {
  const names = (await rows(ids.nadiia, 'select full_name from public.students')).map((r) => r.full_name);
  assert.deepEqual(names, ['Ліна']);
});

test('teacher sees how many lessons are left but not what the student paid', async () => {
  const usage = await rows(ids.nadiia, 'select lessons_left from public.package_usage');
  assert.deepEqual(usage.map((u) => u.lessons_left), [4]);
  assert.equal((await rows(ids.nadiia, 'select * from public.student_payments')).length, 0);
});

test('teacher cannot add a student or change rates', async () => {
  assert.ok(await fails(ids.nadiia, `insert into public.students (full_name) values ('X')`));
  assert.ok(await fails(ids.nadiia,
    `insert into public.teacher_rates (teacher_id, kind, band, amount) values ($1, 'individual', 'B', 9999)`,
    [ids.nadiia]));
});

test('teacher cannot create a lesson for another teacher\'s student', async () => {
  assert.ok(await fails(ids.nadiia,
    `insert into public.lessons (teacher_id, student_id, starts_at) values ($1, $2, now())`,
    [ids.nadiia, ids.maksym]));
});

test('marking a lesson done pays the B1 rate and uses a package seat', async () => {
  const [l] = await rows(ids.nadiia,
    `insert into public.lessons (teacher_id, student_id, kind, starts_at)
     values ($1, $2, 'trial', '2026-06-03 16:00+03') returning id, kind, band`,
    [ids.nadiia, ids.lina]);
  // a teacher cannot turn a regular lesson into a better-paid kind
  assert.equal(l.kind, 'individual');
  assert.equal(l.band, 'B');
  await rows(ids.nadiia, `update public.lessons set status = 'done' where id = $1`, [l.id]);
  const [pay] = await rows(ids.nadiia, 'select amount from public.lesson_pay where lesson_id = $1', [l.id]);
  assert.equal(Number(pay.amount), 420);
  const [u] = await rows(ids.nadiia, 'select lessons_used from public.package_usage where package_id = $1', [ids.linaPkg]);
  assert.equal(u.lessons_used, 1);
  ids.firstLesson = l.id;
});

test('a lesson cannot be marked done before it starts', async () => {
  const [l] = await rows(ids.nadiia,
    `insert into public.lessons (teacher_id, student_id, starts_at)
     values ($1, $2, now() + interval '3 days') returning id`, [ids.nadiia, ids.lina]);
  const err = await fails(ids.nadiia, `update public.lessons set status = 'done' where id = $1`, [l.id]);
  assert.match(err, /before it starts/);
});

test('undoing "done" removes the pay and frees the seat', async () => {
  await rows(ids.nadiia, `update public.lessons set status = 'scheduled' where id = $1`, [ids.firstLesson]);
  assert.equal((await rows(ids.owner, 'select * from public.lesson_pay where lesson_id = $1', [ids.firstLesson])).length, 0);
  const [u] = await rows(ids.owner, 'select lessons_used from public.package_usage where package_id = $1', [ids.linaPkg]);
  assert.equal(u.lessons_used, 0);
  await rows(ids.nadiia, `update public.lessons set status = 'done' where id = $1`, [ids.firstLesson]);
});

test('the 4th lesson finishes the package and the student shows as not renewed', async () => {
  for (const day of ['10', '17', '24']) {
    await rows(ids.nadiia,
      `insert into public.lessons (teacher_id, student_id, starts_at, status)
       values ($1, $2, $3, 'done')`, [ids.nadiia, ids.lina, `2026-06-${day} 16:00+03`]);
  }
  const [p] = await rows(ids.owner, 'select status from public.packages where id = $1', [ids.linaPkg]);
  assert.equal(p.status, 'finished');
  const nr = await rows(ids.agata, 'select full_name from public.students_not_renewed');
  assert.deepEqual(nr.map((r) => r.full_name), ['Ліна']);
});

test('teacher sees own pay only, never a colleague\'s', async () => {
  await rows(ids.toma,
    `insert into public.lessons (teacher_id, student_id, starts_at, status)
     values ($1, $2, '2026-06-05 10:00+03', 'done')`, [ids.toma, ids.maksym]);
  const mine = await rows(ids.nadiia, 'select total, lessons_count from public.monthly_payouts');
  assert.equal(mine.length, 1);
  assert.equal(Number(mine[0].total), 4 * 420);
  assert.equal((await rows(ids.nadiia, 'select * from public.lessons where teacher_id = $1', [ids.toma])).length, 0);
});

test('head teacher sees lessons and packages but no money', async () => {
  assert.ok((await rows(ids.agata, 'select * from public.lessons')).length >= 5);
  assert.equal((await rows(ids.agata, 'select * from public.lesson_pay')).length, 0);
  assert.equal((await rows(ids.agata, 'select * from public.monthly_payouts')).length, 0);
  assert.equal((await rows(ids.agata, 'select * from public.student_payments')).length, 0);
  assert.equal((await rows(ids.agata, 'select * from public.teacher_rates')).length, 0);
});

test('owner sees every payout including extra lines', async () => {
  await rows(ids.owner,
    `insert into public.payout_adjustments (teacher_id, month, description, amount)
     values ($1, '2026-06-01', 'Zoom 20€', 1015)`, [ids.toma]);
  const all = await rows(ids.owner, 'select teacher_name, total from public.monthly_payouts order by teacher_name');
  assert.deepEqual(all.map((r) => [r.teacher_name, Number(r.total)]), [['Надія', 1680], ['Тома', 520 + 1015]]);
});

test('a paid month is locked for teachers', async () => {
  await rows(ids.owner,
    `insert into public.payout_reviews (teacher_id, month, status) values ($1, '2026-06-01', 'paid')`,
    [ids.nadiia]);
  const err = await fails(ids.nadiia, `update public.lessons set note = 'edit' where id = $1`, [ids.firstLesson]);
  assert.match(err, /already paid/);
});

test('library: teachers read, managers do not, teachers cannot publish to the library', async () => {
  await rows(ids.agata,
    `insert into public.files (title, storage_path, visibility) values ('Підручник Б1', 'library/b1.pdf', 'library')`);
  assert.equal((await rows(ids.nadiia, 'select * from public.files')).length, 1);
  assert.equal((await rows(ids.manager, 'select * from public.files')).length, 0);
  assert.ok(await fails(ids.nadiia,
    `insert into public.files (title, storage_path, visibility) values ('x', 'library/x.pdf', 'library')`));
  await rows(ids.nadiia,
    `insert into public.files (title, storage_path, visibility) values ('Мій аркуш', 'private/n1.pdf', 'private')`);
  assert.equal((await rows(ids.toma, `select * from public.files where visibility = 'private'`)).length, 0);
});

test('a person cannot change their own role', async () => {
  assert.ok(await fails(ids.nadiia, `update public.profiles set role = 'owner' where id = $1`, [ids.nadiia]));
  await rows(ids.nadiia, `update public.profiles set locale = 'en' where id = $1`, [ids.nadiia]);
});

// --- School rules from the "Правила занять" card -------------------------

test('no-show counts and is paid, an in-time cancellation does not', async () => {
  const [pkg] = await rows(ids.manager,
    `insert into public.packages (student_id, lessons_total) values ($1, 8) returning id`, [ids.lina]);
  ids.linaPkg2 = pkg.id;
  const [a] = await rows(ids.nadiia,
    `insert into public.lessons (teacher_id, student_id, starts_at, status)
     values ($1, $2, now() - interval '2 days', 'no_show') returning id`, [ids.nadiia, ids.lina]);
  const [b] = await rows(ids.nadiia,
    `insert into public.lessons (teacher_id, student_id, starts_at, status)
     values ($1, $2, now() - interval '1 day', 'cancelled') returning id`, [ids.nadiia, ids.lina]);
  const pay = await rows(ids.owner, 'select lesson_id, amount from public.lesson_pay where lesson_id in ($1, $2)', [a.id, b.id]);
  assert.deepEqual(pay.map((p) => [p.lesson_id, Number(p.amount)]), [[a.id, 420]]);
  const [u] = await rows(ids.owner, 'select lessons_used from public.package_usage where package_id = $1', [ids.linaPkg2]);
  assert.equal(u.lessons_used, 1);
});

test('a late cancellation only counts inside the 24 h window', async () => {
  const far = await fails(ids.nadiia,
    `insert into public.lessons (teacher_id, student_id, starts_at, status)
     values ($1, $2, now() + interval '3 days', 'late_cancel')`, [ids.nadiia, ids.lina]);
  assert.match(far, /Cancelled in time/);
  await rows(ids.nadiia,
    `insert into public.lessons (teacher_id, student_id, starts_at, status)
     values ($1, $2, now() + interval '5 hours', 'late_cancel')`, [ids.nadiia, ids.lina]);
  const [u] = await rows(ids.owner, 'select lessons_used from public.package_usage where package_id = $1', [ids.linaPkg2]);
  assert.equal(u.lessons_used, 2);
});

test('force majeure extends the package by a week', async () => {
  await rows(ids.nadiia,
    `insert into public.lessons (teacher_id, student_id, starts_at, status)
     values ($1, $2, now() + interval '2 hours', 'force_majeure')`, [ids.nadiia, ids.lina]);
  const [p] = await rows(ids.owner, 'select extra_days from public.packages where id = $1', [ids.linaPkg2]);
  assert.equal(p.extra_days, 7);
});

test('a package expires a month after the first lesson, later lessons do not use it', async () => {
  const [ostap] = await rows(ids.manager,
    `insert into public.students (full_name, level, teacher_id) values ('Остап', 'B1', $1) returning id`, [ids.toma]);
  const [pkg] = await rows(ids.manager,
    `insert into public.packages (student_id, lessons_total) values ($1, 4) returning id`, [ostap.id]);
  await rows(ids.toma,
    `insert into public.lessons (teacher_id, student_id, starts_at, status)
     values ($1, $2, now() - interval '50 days', 'done')`, [ids.toma, ostap.id]);
  const [late] = await rows(ids.toma,
    `insert into public.lessons (teacher_id, student_id, starts_at, status)
     values ($1, $2, now() - interval '1 day', 'done') returning package_id`, [ids.toma, ostap.id]);
  assert.equal(late.package_id, null);
  const [u] = await rows(ids.manager, 'select status, lessons_left from public.package_usage where package_id = $1', [pkg.id]);
  assert.deepEqual([u.status, u.lessons_left], ['expired', 3]);
  const nr = await rows(ids.manager, 'select full_name from public.students_not_renewed order by full_name');
  assert.ok(nr.map((r) => r.full_name).includes('Остап'));
});

// --- Rate rules from the September list ----------------------------------

test('international students pay the teacher the international rate', async () => {
  const [shreya] = await rows(ids.manager,
    `insert into public.students (full_name, level, market, locale, teacher_id)
     values ('Shreya', 'A2', 'intl', 'en', $1) returning id`, [ids.toma]);
  await rows(ids.owner,
    `insert into public.teacher_rates (teacher_id, kind, market, amount, valid_from)
     values ($1, 'individual', 'intl', 600, '2026-01-01')`, [ids.toma]);
  const [l] = await rows(ids.toma,
    `insert into public.lessons (teacher_id, student_id, starts_at, status)
     values ($1, $2, now() - interval '3 hours', 'done') returning id`, [ids.toma, shreya.id]);
  const [p] = await rows(ids.toma, 'select amount from public.lesson_pay where lesson_id = $1', [l.id]);
  assert.equal(Number(p.amount), 600);
});

test('a rate set for one student beats the general one (420 vs 460)', async () => {
  const [anatolii] = await rows(ids.manager,
    `insert into public.students (full_name, level, teacher_id) values ('Анатолій', 'B1', $1) returning id`, [ids.nadiia]);
  await rows(ids.owner,
    `insert into public.teacher_rates (teacher_id, kind, student_id, amount, valid_from)
     values ($1, 'individual', $2, 460, '2026-01-01')`, [ids.nadiia, anatolii.id]);
  const [l] = await rows(ids.nadiia,
    `insert into public.lessons (teacher_id, student_id, starts_at, status)
     values ($1, $2, now() - interval '3 hours', 'done') returning id`, [ids.nadiia, anatolii.id]);
  const [p] = await rows(ids.nadiia, 'select amount from public.lesson_pay where lesson_id = $1', [l.id]);
  assert.equal(Number(p.amount), 460);
});

test('pairs and groups are paid per lesson at their own rate', async () => {
  const [pair] = await rows(ids.manager,
    `insert into public.groups (name, level, kind, teacher_id) values ('Крістіна + 1', 'B1', 'pair', $1) returning id`,
    [ids.toma]);
  await rows(ids.owner,
    `insert into public.teacher_rates (teacher_id, kind, amount, valid_from) values ($1, 'pair', 600, '2026-01-01')`,
    [ids.toma]);
  const [l] = await rows(ids.toma,
    `insert into public.lessons (teacher_id, group_id, starts_at, status)
     values ($1, $2, now() - interval '3 hours', 'done') returning id, kind`, [ids.toma, pair.id]);
  assert.equal(l.kind, 'pair');
  const [p] = await rows(ids.toma, 'select amount from public.lesson_pay where lesson_id = $1', [l.id]);
  assert.equal(Number(p.amount), 600);
});

test('a substitute teacher is paid and sees the student of that lesson', async () => {
  const [l] = await rows(ids.manager,
    `insert into public.lessons (teacher_id, student_id, starts_at)
     values ($1, $2, now() - interval '2 hours') returning id`, [ids.nadiia, ids.maksym]);
  await rows(ids.nadiia, `update public.lessons set status = 'done' where id = $1`, [l.id]);
  const seen = (await rows(ids.nadiia, 'select full_name from public.students')).map((r) => r.full_name);
  assert.ok(seen.includes('Максим'));
  const [p] = await rows(ids.nadiia, 'select amount from public.lesson_pay where lesson_id = $1', [l.id]);
  assert.equal(Number(p.amount), 420);
});

test('a teacher cannot book a lesson for a student just because they once substituted', async () => {
  assert.ok(await fails(ids.nadiia,
    `insert into public.lessons (teacher_id, student_id, starts_at) values ($1, $2, now())`,
    [ids.nadiia, ids.maksym]));
});

test('B1+ is 420 for an 8-lesson package and 460 for a 12-lesson one', async () => {
  const [olena] = await rows(ids.manager,
    `insert into public.students (full_name, level, teacher_id) values ('Олена-студентка', 'B1', $1) returning id`, [ids.nadiia]);
  const [iryna] = await rows(ids.manager,
    `insert into public.students (full_name, level, teacher_id) values ('Ірина', 'B2', $1) returning id`, [ids.nadiia]);
  await rows(ids.manager, `insert into public.packages (student_id, lessons_total) values ($1, 8), ($2, 12)`,
    [olena.id, iryna.id]);
  await rows(ids.owner,
    `insert into public.teacher_rates (teacher_id, kind, band, package_lessons, amount, valid_from)
     values ($1, 'individual', 'B', 12, 460, '2026-01-01')`, [ids.nadiia]);
  const pay = [];
  for (const s of [olena.id, iryna.id]) {
    const [l] = await rows(ids.nadiia,
      `insert into public.lessons (teacher_id, student_id, starts_at, status)
       values ($1, $2, now() - interval '3 hours', 'done') returning id`, [ids.nadiia, s]);
    const [p] = await rows(ids.nadiia, 'select amount from public.lesson_pay where lesson_id = $1', [l.id]);
    pay.push(Number(p.amount));
  }
  assert.deepEqual(pay, [420, 460]);
});

// --- Invites -------------------------------------------------------------

test('an invited teacher gets a profile and rates on first sign-in', async () => {
  await rows(ids.owner,
    `insert into public.invites (email, full_name, role, pending_rates) values
     ('lena@lanhub.test', 'Лена', 'teacher',
      '[{"kind":"individual","band":"A","amount":400},
        {"kind":"individual","band":"B","amount":420},
        {"kind":"individual","band":"B","package_lessons":12,"amount":460}]')`);
  const { rows: [u] } = await db.query(
    `insert into auth.users (id, email) values (gen_random_uuid(), 'Lena@LanHub.test') returning id`);
  const [p] = await rows(u.id, 'select full_name, role from public.profiles where id = $1', [u.id]);
  assert.deepEqual([p.full_name, p.role], ['Лена', 'teacher']);
  const rates = await rows(u.id, 'select amount from public.teacher_rates order by amount');
  assert.deepEqual(rates.map((r) => Number(r.amount)), [400, 420, 460]);
});

test('someone without an invite can sign in but sees nothing', async () => {
  const { rows: [u] } = await db.query(
    `insert into auth.users (id, email) values (gen_random_uuid(), 'stranger@mail.test') returning id`);
  assert.equal((await rows(u.id, 'select * from public.profiles')).length, 0);
  assert.equal((await rows(u.id, 'select * from public.students')).length, 0);
  assert.equal((await rows(u.id, 'select * from public.lessons')).length, 0);
  assert.equal((await rows(u.id, 'select * from public.files')).length, 0);
  ids.stranger = u.id;
});

test('inviting someone who already signed in gives them access at once', async () => {
  await rows(ids.owner,
    `insert into public.invites (email, full_name, role) values ('stranger@mail.test', 'Вікторія', 'manager')`);
  const [p] = await rows(ids.stranger, 'select role from public.profiles where id = $1', [ids.stranger]);
  assert.equal(p.role, 'manager');
});

test('a manager cannot invite staff, a teacher cannot invite anyone', async () => {
  assert.ok(await fails(ids.manager,
    `insert into public.invites (email, full_name, role) values ('x@lanhub.test', 'X', 'teacher')`));
  assert.ok(await fails(ids.nadiia,
    `insert into public.invites (email, full_name, role) values ('y@lanhub.test', 'Y', 'student')`));
});

test('only the owner switches people off, and not herself', async () => {
  assert.ok(await fails(ids.manager, `select public.set_profile_active($1, false)`, [ids.toma]));
  assert.match(await fails(ids.owner, `select public.set_profile_active($1, false)`, [ids.owner]), /yourself/);
  await rows(ids.owner, `select public.set_profile_active($1, false)`, [ids.toma]);
  // a switched-off teacher sees nothing
  assert.equal((await rows(ids.toma, 'select * from public.students')).length, 0);
  await rows(ids.owner, `select public.set_profile_active($1, true)`, [ids.toma]);
});
