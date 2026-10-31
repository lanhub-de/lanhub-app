# LanHub platform

The school's own platform: lesson log, teacher payouts, students and packages,
and a protected library. Stage 1 of the plan in the "Платформа LanHub" document.

## Where things run

| Part | Service | Notes |
| --- | --- | --- |
| Database, sign-in, files | Supabase project `lanhub-app` (Frankfurt) | All access rules live in the database |
| Website | Render web service `lanhub-app` (Frankfurt) | Deploys automatically on every push to `main` |
| Code | GitHub `lanhub-de/lanhub-app` | |

## Roles

owner, head_teacher, manager, teacher (student logins come in stage 3).
Who sees what is enforced by row level security in
`supabase/migrations/20261031000001_init.sql` and tested in `tests/db.test.mjs`.

## School rules built in

- A package is valid one month from the first lesson; unused lessons expire.
- Cancelling at least 24 h before (per teacher) does not count; a later cancellation
  or a no-show counts as held and is paid.
- Force majeure does not count and extends the package by 7 days.
- Pay is calculated from rate rules: the most specific rule wins
  (own student or group, then market, then package size, then level band).

## People

The owner invites people by email on the Team page, picking a rate set.
Their profile and rates are created the first time they sign in with a code.

## Developing

```
npm install
cp .env.example .env.local
npm test        # database rules in an in-memory Postgres
npm run dev
```

Database changes are new files in `supabase/migrations/`, applied in order.
