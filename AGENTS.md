# AGENTS.md

Arabic-only, RTL, mobile-first app for a Quran memorization circle. Roles: الشيخ (admin), مشرف (one group), محفظ (assigned students), طالب (student).

- `public/` static app, no build step. `index.html` + `css/app.css` (tokens, one button pair, one card, radius 6/10/16) + `js/` (`app.js` router, `core.js` api/session, `ui.js` DOM helpers, `parts.js` shared plan UI, `views/*`). All copy lives in `js/lib/msgs.js`. Never put user data into `innerHTML`; use `h()`.
- `public/js/lib/{plan,semester,names}.js` are shared by browser and Worker. Plan rows use DB column names (`new_memorization`, `day_number`).
- `src/worker.js` serves `/api/*` (everything else is static assets). Supabase is called over PostgREST with the secret key; RLS blocks all other access. Authorization lives in `studentFor` / `scope`. Passwords are PBKDF2 hashes; old plain-text values upgrade on first login. Sessions are an HMAC-signed HttpOnly cookie.
- Grading rules are in `gradeOne` and `public/js/lib/plan.js`. Debts: `mark_ungraded_as_debt` (SQL) via cron `0 13 * * *` UTC (= 4 PM Riyadh) and the Sheikh's button.
- Schema changes go in `supabase/schema.sql` (idempotent) plus a note for existing databases.
- Tests: `npm test` (Worker against `test/fake-supabase.mjs`). Keep `get()` paginated: PostgREST caps at 1000 rows. Keep Worker subrequests low (Free plan: 50 per request): batch with `upsert` / `in.(...)`.
