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
  create function storage.foldername(name text) returns text[] language sql immutable as
    $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  alter table storage.objects enable row level security;
  grant usage on schema storage to authenticated;
  grant select, insert, delete on storage.objects to authenticated;
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

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------
test('a new group gets its 8 lessons on its weekdays at Vienna time', async () => {
  const [p3] = await rows(ids.agata,
    `insert into public.programs (title, level) values ('German Activation · Flow 3', 'A2–B1') returning id`);
  ids.flow3 = p3.id;
  await rows(ids.agata,
    `insert into public.program_lessons (program_id, n, title) select $1, n, 'Lesson ' || n from generate_series(1, 8) n`,
    [ids.flow3]);
  const [p4] = await rows(ids.owner,
    `insert into public.programs (title, level) values ('German Activation · Flow 4', 'A2–B1') returning id`);
  ids.flow4 = p4.id;
  await rows(ids.owner,
    `insert into public.program_lessons (program_id, n, title) select $1, n, 'L' || n from generate_series(1, 8) n`,
    [ids.flow4]);
  await rows(ids.owner, 'update public.programs set next_program_id = $2 where id = $1', [ids.flow3, ids.flow4]);
  await db.query(
    `insert into public.teacher_rates (teacher_id, kind, amount, valid_from) values ($1, 'group', 900, '2026-01-01')`,
    [ids.toma]);

  const [{ create_group: gid }] = await rows(ids.manager,
    `select public.create_group($1, $2, array[2, 4], '20:10', '2026-09-07', 10, 'https://zoom.example/g')`,
    [ids.flow3, ids.toma]);
  ids.g3 = gid;
  const ls = await rows(ids.manager,
    `select to_char(starts_at at time zone 'Europe/Vienna', 'Dy DD.MM HH24:MI') as t, duration_min, kind, zoom_url
       from public.lessons where group_id = $1 order by starts_at`, [gid]);
  assert.equal(ls.length, 8);
  assert.deepEqual(ls.slice(0, 3).map((l) => l.t), ['Tue 08.09 20:10', 'Thu 10.09 20:10', 'Tue 15.09 20:10']);
  assert.equal(ls[7].t, 'Thu 01.10 20:10');
  assert.equal(ls[0].duration_min, 90);
  assert.equal(ls[0].kind, 'group');
  assert.equal(ls[0].zoom_url, 'https://zoom.example/g');
  const [g] = await rows(ids.manager, 'select name, lessons_total, capacity from public.group_overview where id = $1', [gid]);
  assert.equal(g.name, 'German Activation · Flow 3 · Tue/Thu 20:10');
  assert.equal(g.lessons_total, 8);
});

test('only the owner and head teacher write programs; teachers cannot create groups', async () => {
  assert.ok(await fails(ids.manager, `insert into public.programs (title) values ('X')`));
  assert.ok(await fails(ids.toma,
    `insert into public.program_lessons (program_id, n, title) values ($1, 9, 'X')`, [ids.flow3]));
  assert.ok(await fails(ids.toma,
    `select public.create_group($1, $2, array[1], '10:00', '2026-11-16')`, [ids.flow3, ids.toma]));
  const [{ c }] = await rows(ids.toma,
    'select count(*)::int as c from public.program_lessons where program_id = $1', [ids.flow3]);
  assert.equal(c, 8);
});

test('group lesson: the teacher marks who missed it and gets the group rate', async () => {
  const [s1] = await rows(ids.manager,
    `insert into public.students (full_name, level, market) values ('Sarah', 'A2', 'intl') returning id`);
  const [s2] = await rows(ids.manager,
    `insert into public.students (full_name, level, market) values ('Marco', 'B1', 'intl') returning id`);
  ids.sarah = s1.id;
  ids.marco = s2.id;
  await rows(ids.manager,
    'insert into public.group_members (group_id, student_id) values ($1, $2), ($1, $3)', [ids.g3, ids.sarah, ids.marco]);
  const [first] = await rows(ids.toma,
    'select id from public.lessons where group_id = $1 order by starts_at limit 1', [ids.g3]);
  ids.g3first = first.id;
  const names = (await rows(ids.toma,
    'select full_name from public.students where id in ($1, $2) order by full_name', [ids.sarah, ids.marco]))
    .map((r) => r.full_name);
  assert.deepEqual(names, ['Marco', 'Sarah']);

  await rows(ids.toma, 'insert into public.lesson_absences (lesson_id, student_id) values ($1, $2)', [first.id, ids.marco]);
  assert.ok(await fails(ids.nadiia,
    'insert into public.lesson_absences (lesson_id, student_id) values ($1, $2)', [first.id, ids.sarah]));

  await rows(ids.toma,
    `update public.lessons set status = 'done', recording_url = 'https://rec.example/1', program_lesson_id = null
      where id = $1`, [first.id]);
  const [l] = await rows(ids.toma,
    'select status, recording_url, program_lesson_id is not null as linked from public.lessons where id = $1', [first.id]);
  assert.equal(l.status, 'done');
  assert.equal(l.recording_url, 'https://rec.example/1');
  assert.equal(l.linked, true);
  const [pay] = await rows(ids.toma, 'select amount from public.lesson_pay where lesson_id = $1', [first.id]);
  assert.equal(Number(pay.amount), 900);
  const [o] = await rows(ids.agata, 'select lessons_done, members from public.group_overview where id = $1', [ids.g3]);
  assert.equal(o.lessons_done, 1);
  assert.equal(o.members, 2);
});

test('a substitute for a group lesson sees the group and its people', async () => {
  const [second] = await rows(ids.manager,
    `update public.lessons set teacher_id = $2
      where id = (select id from public.lessons where group_id = $1 order by starts_at offset 1 limit 1)
      returning id`, [ids.g3, ids.nadiia]);
  const groups = await rows(ids.nadiia, 'select name from public.groups where id = $1', [ids.g3]);
  assert.equal(groups.length, 1);
  const members = await rows(ids.nadiia, 'select student_id from public.group_members where group_id = $1', [ids.g3]);
  assert.equal(members.length, 2);
  await rows(ids.nadiia, 'insert into public.lesson_absences (lesson_id, student_id) values ($1, $2)', [second.id, ids.sarah]);
});

test('a finished group continues into the next flow with the same people and timetable', async () => {
  const [{ continue_group: next }] = await rows(ids.manager, 'select public.continue_group($1)', [ids.g3]);
  const [g] = await rows(ids.manager,
    `select g.program_id, g.continued_from, g.teacher_id, g.days, o.members, o.lessons_total
       from public.groups g join public.group_overview o on o.id = g.id where g.id = $1`, [next]);
  assert.equal(g.program_id, ids.flow4);
  assert.equal(g.continued_from, ids.g3);
  assert.equal(g.teacher_id, ids.toma);
  assert.deepEqual(g.days, [2, 4]);
  assert.equal(g.members, 2);
  assert.equal(g.lessons_total, 8);
  const [firstNext] = await rows(ids.manager,
    `select to_char(starts_at at time zone 'Europe/Vienna', 'Dy DD.MM HH24:MI') as t
       from public.lessons where group_id = $1 order by starts_at limit 1`, [next]);
  assert.equal(firstNext.t, 'Tue 06.10 20:10');
});

// ---------------------------------------------------------------------------
// Students and their course page
// ---------------------------------------------------------------------------
test('a group student signs in with the email on their card and sees only their course', async () => {
  await rows(ids.manager, `update public.students set email = 'sarah@example.com' where id = $1`, [ids.sarah]);
  const { rows: [u] } = await db.query('select gen_random_uuid() as id');
  ids.sarahLogin = u.id;
  await db.query(`insert into auth.users (id, email) values ($1, 'Sarah@example.com')`, [u.id]);
  const [p] = await rows(ids.sarahLogin, 'select role, full_name from public.profiles where id = $1', [u.id]);
  assert.equal(p.role, 'student');
  assert.equal(p.full_name, 'Sarah');

  const mine = await rows(ids.sarahLogin, 'select * from public.my_course_groups()');
  assert.deepEqual(mine.map((g) => g.id).sort(), [ids.g3, (await db.query(
    'select id from public.groups where continued_from = $1', [ids.g3])).rows[0].id].sort());

  const [head] = await rows(ids.sarahLogin, 'select program_title, teacher_name, zoom_url from public.course_group($1)', [ids.g3]);
  assert.equal(head.program_title, 'German Activation · Flow 3');
  assert.equal(head.teacher_name, 'Тома');
  assert.equal((await rows(ids.sarahLogin, 'select * from public.course_schedule($1)', [ids.g3])).length, 8);
  const lessons = await rows(ids.sarahLogin, 'select * from public.course_lessons($1)', [ids.g3]);
  assert.equal(lessons.length, 8);
  assert.ok(!('teacher_note' in lessons[0]));

  // nothing from the raw tables
  assert.equal((await rows(ids.sarahLogin, 'select * from public.program_lessons')).length, 0);
  assert.equal((await rows(ids.sarahLogin, 'select * from public.lessons where group_id = $1', [ids.g3])).length, 0);
  assert.equal((await rows(ids.sarahLogin, 'select * from public.lesson_pay')).length, 0);
  assert.equal((await rows(ids.sarahLogin, 'select * from public.students where id <> $1', [ids.sarah])).length, 0);
});

test('a student cannot open another group\'s course page', async () => {
  const [{ create_group: other }] = await rows(ids.manager,
    `select public.create_group($1, $2, array[1, 3], '08:00', '2026-09-07')`, [ids.flow3, ids.toma]);
  assert.equal((await rows(ids.sarahLogin, 'select * from public.course_group($1)', [other])).length, 0);
  assert.equal((await rows(ids.sarahLogin, 'select * from public.course_lessons($1)', [other])).length, 0);
});

test('students open course files meant for them, never teacher-only ones', async () => {
  const [guide] = await rows(ids.agata,
    `insert into public.files (title, storage_path) values ('Guide 1', 'library/guide1.pdf') returning id`);
  const [tguide] = await rows(ids.agata,
    `insert into public.files (title, storage_path) values ('Teacher guide', 'library/tguide.pdf') returning id`);
  await rows(ids.agata, 'insert into public.program_files (program_id, file_id) values ($1, $2)', [ids.flow3, guide.id]);
  await rows(ids.agata,
    `insert into public.program_lesson_files (program_lesson_id, file_id, for_students)
     select id, $2, false from public.program_lessons where program_id = $1 and n = 1`, [ids.flow3, tguide.id]);
  const files = await rows(ids.sarahLogin, 'select title from public.course_files($1)', [ids.g3]);
  assert.deepEqual(files.map((f) => f.title), ['Guide 1']);
  const visible = (await rows(ids.sarahLogin, 'select title from public.files order by title')).map((f) => f.title);
  assert.deepEqual(visible, ['Guide 1']);
});

test('an email added to a card later links a student who already signed in', async () => {
  const { rows: [u] } = await db.query('select gen_random_uuid() as id');
  await db.query(`insert into auth.users (id, email) values ($1, 'marco@example.com')`, [u.id]);
  assert.equal((await db.query('select * from public.profiles where id = $1', [u.id])).rows.length, 0);
  await rows(ids.manager, `update public.students set email = 'marco@example.com' where id = $1`, [ids.marco]);
  const [p] = (await db.query('select role from public.profiles where id = $1', [u.id])).rows;
  assert.equal(p.role, 'student');
  assert.equal((await rows(u.id, 'select * from public.course_group($1)', [ids.g3])).length, 1);
});

// ---------------------------------------------------------------------------
// Pay by attendance and monthly extras
// ---------------------------------------------------------------------------
test('group pay follows how many came: Agata 600 / 750 / 900 / 1050 / 1200', async () => {
  const [rate] = await rows(ids.owner,
    `insert into public.teacher_rates (teacher_id, kind, amount, valid_from) values ($1, 'group', 600, '2026-09-01')
     returning id`, [ids.agata]);
  await rows(ids.owner,
    `insert into public.rate_steps (rate_id, min_present, amount) values
     ($1, 3, 750), ($1, 4, 900), ($1, 5, 1050), ($1, 6, 1200)`, [rate.id]);
  assert.equal((await rows(ids.agata, 'select * from public.rate_steps')).length, 4);
  assert.equal((await rows(ids.nadiia, 'select * from public.rate_steps')).length, 0);
  await rows(ids.agata, 'update public.rate_steps set amount = 2000');
  const [{ m }] = await rows(ids.owner, 'select max(amount)::int as m from public.rate_steps where rate_id = $1', [rate.id]);
  assert.equal(m, 1200);
  const [{ create_group: gid }] = await rows(ids.manager,
    `select public.create_group($1, $2, array[1, 3], '19:00', '2026-10-26')`, [ids.flow3, ids.agata]);
  const studs = await rows(ids.manager,
    `insert into public.students (full_name, market) select 'S' || n, 'intl' from generate_series(1, 7) n returning id`);
  for (const s of studs) {
    await rows(ids.manager, 'insert into public.group_members (group_id, student_id) values ($1, $2)', [gid, s.id]);
  }
  const [l1] = await rows(ids.agata, 'select id from public.lessons where group_id = $1 order by starts_at limit 1', [gid]);
  const pay = async () => Number((await rows(ids.agata, 'select amount from public.lesson_pay where lesson_id = $1', [l1.id]))[0].amount);

  // 2 of 7 missed it: 5 came
  await rows(ids.agata, 'insert into public.lesson_absences (lesson_id, student_id) values ($1, $2), ($1, $3)',
    [l1.id, studs[0].id, studs[1].id]);
  await rows(ids.agata, `update public.lessons set status = 'done' where id = $1`, [l1.id]);
  assert.equal(await pay(), 1050);
  const [{ lesson_present: n }] = await rows(ids.agata, 'select public.lesson_present($1)', [l1.id]);
  assert.equal(n, 5);

  // marked later: one more absent, then present again
  await rows(ids.agata, 'insert into public.lesson_absences (lesson_id, student_id) values ($1, $2)', [l1.id, studs[2].id]);
  assert.equal(await pay(), 900);
  await rows(ids.agata, 'delete from public.lesson_absences where lesson_id = $1 and student_id = $2', [l1.id, studs[2].id]);
  assert.equal(await pay(), 1050);

  // everyone came
  await rows(ids.agata, 'delete from public.lesson_absences where lesson_id = $1', [l1.id]);
  assert.equal(await pay(), 1200);
  // only 2 came
  await rows(ids.agata,
    'insert into public.lesson_absences (lesson_id, student_id) select $1, unnest($2::uuid[])',
    [l1.id, studs.slice(0, 5).map((s) => s.id)]);
  assert.equal(await pay(), 600);
});

test('Zoom and other monthly extras: the owner sets them, the teacher sees only her own', async () => {
  const [a] = await rows(ids.owner,
    `insert into public.teacher_allowances (teacher_id, label, amount, currency, starts_on)
     values ($1, 'Zoom', 19, 'EUR', '2026-11-01') returning id`, [ids.agata]);
  await rows(ids.owner,
    `insert into public.teacher_allowances (teacher_id, label, amount, starts_on) values ($1, 'Zoom', 913, '2026-11-01')`,
    [ids.toma]);
  assert.equal((await rows(ids.agata, 'select * from public.teacher_allowances')).length, 1);
  assert.equal((await rows(ids.manager, 'select * from public.teacher_allowances')).length, 0);
  assert.ok(await fails(ids.agata,
    `insert into public.teacher_allowances (teacher_id, label, amount) values ($1, 'Zoom', 1000)`, [ids.agata]));

  await rows(ids.owner,
    `insert into public.payout_adjustments (teacher_id, month, description, amount, allowance_id)
     values ($1, '2026-11-01', 'Zoom · 19 €', 930.5, $2)`, [ids.agata, a.id]);
  assert.ok(await fails(ids.owner,
    `insert into public.payout_adjustments (teacher_id, month, description, amount, allowance_id)
     values ($1, '2026-11-01', 'Zoom again', 930.5, $2)`, [ids.agata, a.id]));
});

test('an invite can carry attendance rates and a monthly extra', async () => {
  await rows(ids.owner,
    `insert into public.invites (email, full_name, role, pending_rates, pending_allowances) values
     ('hanna@lanhub.test', 'Ганна', 'teacher',
      '[{"kind":"group","amount":600,"steps":[{"min_present":6,"amount":700}]}]',
      '[{"label":"Zoom","amount":913,"starts_on":"2026-11-01"}]')`);
  const { rows: [u] } = await db.query(
    `insert into auth.users (id, email) values (gen_random_uuid(), 'hanna@lanhub.test') returning id`);
  const rates = await rows(u.id,
    `select tr.amount, s.min_present, s.amount as step from public.teacher_rates tr
       left join public.rate_steps s on s.rate_id = tr.id`);
  assert.deepEqual(rates.map((r) => [Number(r.amount), r.min_present, Number(r.step)]), [[600, 6, 700]]);
  const [z] = await rows(u.id, 'select label, amount, currency, starts_on::text as s from public.teacher_allowances');
  assert.deepEqual([z.label, Number(z.amount), z.currency, z.s], ['Zoom', 913, 'UAH', '2026-11-01']);
});

test('groups and students can wait for an invited teacher and move to her on first sign-in', async () => {
  await rows(ids.owner,
    `insert into public.invites (email, full_name, role, pending_rates) values
     ('olena@lanhub.test', 'Олена', 'teacher',
      '[{"kind":"group","amount":600,"steps":[{"min_present":3,"amount":750}]},
        {"kind":"individual","market":"intl","amount":600}]')`);
  const [{ create_group_for_invite: gid }] = await rows(ids.owner,
    `select public.create_group_for_invite($1, 'olena@lanhub.test', array[2, 4], '18:00', '2026-10-06')`, [ids.flow3]);
  const [o] = await rows(ids.owner,
    'select pending_teacher, pending_teacher_name, lessons_total from public.group_overview where id = $1', [gid]);
  assert.deepEqual([o.pending_teacher, o.pending_teacher_name, o.lessons_total], ['olena@lanhub.test', 'Олена', 8]);
  const [{ c: waiting }] = await rows(ids.owner,
    `select count(*)::int as c from public.lessons where group_id = $1 and pending_teacher = 'olena@lanhub.test'`, [gid]);
  assert.equal(waiting, 8);
  assert.ok(await fails(ids.nadiia,
    `select public.create_group_for_invite($1, 'olena@lanhub.test', array[1], '10:00', '2026-11-02')`, [ids.flow3]));

  const studs = await rows(ids.owner,
    `insert into public.students (full_name, market) select 'O' || n, 'intl' from generate_series(1, 3) n returning id`);
  for (const s of studs) {
    await rows(ids.owner, 'insert into public.group_members (group_id, student_id) values ($1, $2)', [gid, s.id]);
  }
  const [solo] = await rows(ids.owner,
    `insert into public.students (full_name, market, level, pending_teacher)
     values ('Solo', 'intl', 'A2', 'olena@lanhub.test') returning id`);
  await rows(ids.owner, 'insert into public.packages (student_id, lessons_total) values ($1, 8)', [solo.id]);

  // the school marks what already happened: no pay while she has not signed in
  const [first] = await rows(ids.owner, 'select id from public.lessons where group_id = $1 order by starts_at limit 1', [gid]);
  await rows(ids.owner, `update public.lessons set status = 'done' where id = $1`, [first.id]);
  const [ind] = await rows(ids.owner,
    `insert into public.lessons (teacher_id, student_id, starts_at, status, pending_teacher)
     values ($1, $2, '2026-10-20 10:00+02', 'done', 'olena@lanhub.test') returning id, package_id`, [ids.owner, solo.id]);
  assert.ok(ind.package_id);
  assert.equal((await rows(ids.owner, 'select * from public.lesson_pay where lesson_id in ($1, $2)', [first.id, ind.id])).length, 0);

  // first sign-in
  const { rows: [u] } = await db.query(
    `insert into auth.users (id, email) values (gen_random_uuid(), 'olena@lanhub.test') returning id`);
  const [g] = await rows(u.id, 'select teacher_id, pending_teacher from public.groups where id = $1', [gid]);
  assert.deepEqual([g.teacher_id, g.pending_teacher], [u.id, null]);
  const [{ c: mine }] = await rows(u.id,
    'select count(*)::int as c from public.lessons where group_id = $1 and teacher_id = $2', [gid, u.id]);
  assert.equal(mine, 8);
  const pays = await rows(u.id, 'select lesson_id, amount from public.lesson_pay order by amount');
  assert.deepEqual(pays.map((p) => Number(p.amount)).sort(), [600, 750]);
  const [s] = await rows(u.id, 'select teacher_id, pending_teacher from public.students where id = $1', [solo.id]);
  assert.deepEqual([s.teacher_id, s.pending_teacher], [u.id, null]);
});

test('the school hands a group from an invite to a teacher and back', async () => {
  await rows(ids.owner,
    `insert into public.invites (email, full_name, role) values ('daryna@lanhub.test', 'Дарина', 'teacher')`);
  const [{ create_group: gid }] = await rows(ids.manager,
    `select public.create_group($1, $2, array[1, 3], '17:00', '2026-12-07')`, [ids.flow3, ids.toma]);
  await rows(ids.manager, `select public.set_group_teacher($1, null, 'daryna@lanhub.test')`, [gid]);
  const [{ c }] = await rows(ids.manager,
    `select count(*)::int as c from public.lessons where group_id = $1 and pending_teacher = 'daryna@lanhub.test'`, [gid]);
  assert.equal(c, 8);
  await rows(ids.manager, 'select public.set_group_teacher($1, $2, null)', [gid, ids.toma]);
  const [g] = await rows(ids.manager, 'select teacher_id, pending_teacher from public.groups where id = $1', [gid]);
  assert.deepEqual([g.teacher_id, g.pending_teacher], [ids.toma, null]);
  assert.ok(await fails(ids.toma, `select public.set_group_teacher($1, null, 'daryna@lanhub.test')`, [gid]));
});

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------
test('a group student gets her group chat, a chat with her teacher and one with the school', async () => {
  await rows(ids.sarahLogin, 'select public.ensure_my_chats()');
  const chats = await rows(ids.sarahLogin, 'select kind, title, mine from public.my_chats() order by kind, title');
  const kinds = chats.map((c) => `${c.kind}:${c.title}`);
  assert.ok(kinds.includes('direct:Тома'));
  assert.ok(kinds.includes('school:LanHub'));
  assert.ok(kinds.some((k) => k.startsWith('group:German Activation · Flow 3')));
  assert.ok(chats.every((c) => c.mine));
});

test('group chat: members write and read, the head teacher looks in, others see nothing', async () => {
  const [{ start_chat: cid }] = await rows(ids.sarahLogin, `select public.start_chat('group', $1)`, [ids.g3]);
  ids.g3chat = cid;
  await rows(ids.sarahLogin, `insert into public.messages (conversation_id, body) values ($1, 'Hallo zusammen!')`, [cid]);
  // the teacher sees it as unread
  await rows(ids.toma, 'select public.ensure_my_chats()');
  const [c] = await rows(ids.toma, 'select title, unread, last_body, mine from public.my_chats() where id = $1', [cid]);
  assert.equal(c.unread, 1);
  assert.equal(c.last_body, 'Hallo zusammen!');
  assert.equal(c.mine, true);
  await rows(ids.toma, 'select public.mark_chat_read($1)', [cid]);
  const [{ my_unread_total: left }] = await rows(ids.toma, 'select public.my_unread_total()');
  assert.equal(left, 0);
  await rows(ids.toma, `insert into public.messages (conversation_id, body) values ($1, 'Hallo Sarah!')`, [cid]);

  // the head teacher can read for quality control, but it is not her chat
  const [seen] = await rows(ids.agata, 'select mine from public.my_chats() where id = $1', [cid]);
  assert.equal(seen.mine, false);
  assert.equal((await rows(ids.agata, 'select * from public.messages where conversation_id = $1', [cid])).length, 2);
  // a manager and another teacher see nothing and cannot write
  assert.equal((await rows(ids.manager, 'select * from public.messages where conversation_id = $1', [cid])).length, 0);
  assert.equal((await rows(ids.nadiia, 'select * from public.messages where conversation_id = $1', [cid])).length, 0);
  assert.ok(await fails(ids.nadiia, `insert into public.messages (conversation_id, body) values ($1, 'x')`, [cid]));
  // nobody writes in someone else's name
  assert.ok(await fails(ids.sarahLogin,
    `insert into public.messages (conversation_id, sender_id, body) values ($1, $2, 'x')`, [cid, ids.toma]));
});

test('a student cannot open a chat with a teacher who does not teach her', async () => {
  assert.ok(await fails(ids.sarahLogin, `select public.start_chat('direct', null, $1, $2)`, [ids.sarah, ids.nadiia]));
  const [{ start_chat: ok }] = await rows(ids.sarahLogin, `select public.start_chat('direct', null, $1, $2)`, [ids.sarah, ids.toma]);
  assert.ok(ok);
});

test('school chat: the student and the managers, not the teachers', async () => {
  const [{ start_chat: cid }] = await rows(ids.sarahLogin, `select public.start_chat('school', null, $1)`, [ids.sarah]);
  await rows(ids.sarahLogin, `insert into public.messages (conversation_id, body) values ($1, 'Wann zahle ich?')`, [cid]);
  assert.equal((await rows(ids.manager, 'select * from public.messages where conversation_id = $1', [cid])).length, 1);
  assert.equal((await rows(ids.toma, 'select * from public.messages where conversation_id = $1', [cid])).length, 0);
  assert.equal((await rows(ids.agata, 'select * from public.messages where conversation_id = $1', [cid])).length, 0);
  const [m] = await rows(ids.manager, 'select title, mine from public.my_chats() where id = $1', [cid]);
  assert.deepEqual([m.title, m.mine], ['Sarah', true]);
});

test('notifications: only the server (with the secret) learns who to notify, emails at most every 6 hours', async () => {
  await db.query(`insert into private.settings (key, value) values ('chat_secret', 's3cret')`);
  const [msg] = await rows(ids.sarahLogin,
    `insert into public.messages (conversation_id, body) values ($1, 'Frage zur Hausaufgabe') returning id`, [ids.g3chat]);
  assert.ok(await fails(ids.sarahLogin, `select * from public.chat_notify_targets($1, 'guess')`, [msg.id]));
  // Marco signed in earlier, so he is in the group chat too
  const first = await rows(ids.sarahLogin,
    `select full_name, send_email from public.chat_notify_targets($1, 's3cret') order by full_name`, [msg.id]);
  assert.deepEqual(first.map((r) => [r.full_name, r.send_email]), [['Marco', true], ['Тома', true]]);
  const again = await rows(ids.sarahLogin, `select send_email from public.chat_notify_targets($1, 's3cret')`, [msg.id]);
  assert.deepEqual(again.map((r) => r.send_email), [false, false]);
  // with notifications switched on there is no email, only the push
  await rows(ids.toma, `insert into public.push_subscriptions (endpoint, p256dh, auth) values ('https://push.example/1', 'k', 'a')`);
  await db.query('delete from public.chat_emails');
  const withPush = await rows(ids.sarahLogin,
    `select full_name, endpoint, send_email from public.chat_notify_targets($1, 's3cret') order by full_name`, [msg.id]);
  assert.deepEqual(withPush.map((r) => [r.full_name, r.endpoint, r.send_email]),
    [['Marco', null, true], ['Тома', 'https://push.example/1', false]]);
  assert.equal((await rows(ids.sarahLogin, 'select * from public.push_subscriptions')).length, 0);
});

test('chat files: only people in the chat can upload and open them', async () => {
  await as(ids.sarahLogin, (tx) => tx.query(
    `insert into storage.objects (bucket_id, name) values ('chat', $1)`, [`${ids.g3chat}/voice.webm`]));
  assert.ok(await fails(ids.nadiia,
    `insert into storage.objects (bucket_id, name) values ('chat', $1)`, [`${ids.g3chat}/x.png`]));
  assert.equal((await rows(ids.toma, `select * from storage.objects where bucket_id = 'chat'`)).length, 1);
  assert.equal((await rows(ids.nadiia, `select * from storage.objects where bucket_id = 'chat'`)).length, 0);
});
