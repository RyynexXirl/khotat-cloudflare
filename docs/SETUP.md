# Setup: Supabase + Cloudflare

You will do four things, about 30 minutes in total:

1. Create the database on **Supabase** (run one SQL file).
2. *(Only if you already have real users on Netlify)* copy their data across.
3. Deploy the app to **Cloudflare** and give it four secrets.
4. Check that everything works.

## How the pieces connect

```
Browser ──► Cloudflare Worker "khotat" ──► Supabase Postgres
            · serves the app (public/)      · tables + the daily debt function
            · /api/*: login, permissions    · only the Worker's secret key can read/write
            · cron 13:00 UTC (4 PM Riyadh)
```

The browser never talks to Supabase. The Worker holds the Supabase **secret key**, checks who is logged in, and only then reads or writes data. The Supabase public (anon) key is not used anywhere, and Row Level Security blocks it from every table.

The connection is nothing more than **four secrets** on the Worker:

| Secret | Value |
| --- | --- |
| `SUPABASE_URL` | Your project URL, like `https://abcdxyz.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Supabase **secret key** (`sb_secret_…`), or the legacy `service_role` key |
| `SESSION_SECRET` | A long random string you invent (signs login cookies) |
| `SHEIKH_PASSWORD` | The Sheikh's first password (you can change it inside the app later) |

> Treat the secret key like a password. It bypasses all database protection. Never put it in the code, in GitHub, or in a browser.

---

## 1. Supabase

1. Sign in at supabase.com → **New project**. Pick the region closest to your users and save the database password somewhere safe.
2. Wait for the project to finish starting, then open **SQL Editor → New query**.
3. Open `supabase/schema.sql` from this folder, paste all of it, press **Run**. It is safe to run twice. You should see "Success".
4. Open **Table Editor**: you should see `groups` (3 rows), `supervisors`, `muhaffizeen`, `students`, `plan_days`, `settings`.
5. Get your two values (menu labels move around a little between Supabase releases):
   - **Project URL** → `SUPABASE_URL`
   - **Project Settings → API Keys** → copy the **secret key** (`sb_secret_…`) → `SUPABASE_SERVICE_KEY`. If your project only shows the older keys, use the `service_role` key instead. Do **not** use the `anon` / publishable key.

## 2. Move your existing data from Netlify (skip if you are starting fresh)

The zip you gave me only contained the *code and demo seed data*. Your real students, supervisors, plans and grades live in your **Netlify database**, so they must be copied. Do this *before* you tell people to switch.

You need `pg_dump` and `psql` (they come with PostgreSQL's command-line tools).

1. In Netlify, open your site's **Database** page and copy the connection string (starts with `postgres://`). In Supabase press **Connect** and copy the connection string too (use the *session pooler* string if the direct one does not connect from your network).
2. Export the data (replace the quoted strings):

   ```bash
   pg_dump "NETLIFY_CONNECTION_STRING" --data-only --column-inserts --no-owner \
     -t public.supervisors -t public.muhaffizeen -t public.students \
     -t public.plan_days -t public.settings > data.sql
   ```

   (`groups` is left out on purpose: `schema.sql` already created الأجاويد, الارتقاء, الثبات with the same ids. If you added more groups on Netlify, add `-t public.groups` and first run `delete from public.groups;` in Supabase.)
3. Import it:

   ```bash
   psql "SUPABASE_CONNECTION_STRING" -f data.sql
   ```
4. In Supabase **SQL Editor**, run `supabase/after-import.sql` (moves the id counters past the imported rows, so new students do not collide).
5. Passwords: the old app stored them in plain text. The new app accepts the old ones and **re-saves each one hashed the first time that person logs in**. Nobody has to reset anything. The Sheikh's changed password (if any) comes across in `settings` and keeps working.

Then delete `data.sql` (it contains every student's password in plain text).

No command line? Alternative: export each table as CSV from Netlify's database page and use Supabase **Table Editor → Import data from CSV**, in this order: `supervisors`, `muhaffizeen`, `students`, `plan_days`, `settings`; then run `after-import.sql`.

## 3. Cloudflare

You need a free Cloudflare account. The app is a single Worker; there is **no build step**.

### Option A: from GitHub (recommended, redeploys on every push)

1. Create a GitHub repository and upload the contents of this folder (the folder itself should be the repo root: `wrangler.jsonc` at the top).
2. Cloudflare dashboard → **Workers & Pages → Create → Import a repository**, pick the repo.
3. Leave the **build command empty**. The deploy command is `npx wrangler deploy`. Save and deploy. (Labels may differ slightly; the point is: no build command, deploy with wrangler.)
4. The first deploy succeeds but the site will say it is not configured yet. That is expected: add the secrets next.

### Option B: from your computer

Needs Node.js 20+ installed.

```bash
cd khotat            # this folder
npm install
npx wrangler login
npx wrangler deploy
```

### Add the four secrets

Dashboard: your Worker → **Settings → Variables and Secrets → Add**, type **Secret**, one for each name in the table above. Or from the folder:

```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_KEY
npx wrangler secret put SESSION_SECRET
npx wrangler secret put SHEIKH_PASSWORD
```

A good `SESSION_SECRET`: run `openssl rand -base64 48`, or in Node: `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`.

Secrets survive redeploys. If you ever change `SESSION_SECRET`, everyone is simply logged out.

Your site is now live at `https://khotat.<your-account>.workers.dev`. For your own domain: Worker → **Settings → Domains & Routes → Add → Custom domain** (the domain must be on Cloudflare DNS).

## 4. Check that it works

Work through this list in order. Each step proves one part.

1. **Health check.** Open `https://YOUR-SITE/api/health`. You want:
   ```json
   {"ok":true,"database":"ok","configured":{"supabase":true,"session_secret":true,"sheikh_password":true}, ...}
   ```
   `database` tells you what is wrong if not:
   | `database` | Meaning | Fix |
   | --- | --- | --- |
   | `not_configured` | `SUPABASE_URL` or key missing | add the secrets (step 3) |
   | `bad_key` | key rejected | recopy the secret key, no spaces or quotes |
   | `schema_missing` | tables/function not found | run `supabase/schema.sql` (step 1.3) |
   | `unreachable` | wrong URL or Supabase paused | check the URL; free projects pause after inactivity, unpause in Supabase |
2. **Sheikh login.** Open the site → الشيخ → your `SHEIKH_PASSWORD` (or your old Netlify password if you imported data).
3. **Create accounts.** On the dashboard add a مشرف (pick a group) and a محفظ. In Supabase **Table Editor → supervisors** the password column must look like `pbkdf2$…` (hashed), not readable text.
4. **Student flow.** In a private window: **طالب جديد؟ سجّل الآن**, register a test student. Table Editor → `plan_days` should have 52 new rows for that student.
5. **Plan and grading.** As Sheikh open the student's plan → تعديل الخطة, write a few lessons, save. Log in as the مشرف of that group: the student appears; press «تم الحفظ». It must refuse to grade lesson 2 before lesson 1.
6. **Permissions.** Log in as that student: only their own plan. Try opening `/sheikh` by typing it: you are sent back to the student page.
7. **Debts job.** As Sheikh press **احتساب الديون الآن**. Past-dated, ungraded lessons turn into debts (the dashboard debt card goes up). The automatic run is the same code at 4 PM Riyadh every day. To confirm the schedule: Worker → **Settings → Triggers** shows the cron `0 13 * * *`, and after the first 4 PM the Worker's **Logs** show `[auto-debt] marked N lesson(s) as debt`. To test it locally: `npx wrangler dev --test-scheduled`, then `curl "http://localhost:8787/__scheduled?cron=0+13+*+*+*"`.
8. **Print.** Open a plan → تصدير PDF → "Save as PDF" (landscape A4, one page).

Test it all locally first (optional): copy `.dev.vars.example` to `.dev.vars`, fill it in, `npm run dev`. No accounts at all? `npm run preview:fake` runs the real app against an in-memory fake database.

## 5. Recommended before you give out the link

- **Rate limit logins.** Cloudflare dashboard → your domain → **Security → WAF → Rate limiting rules**: match URI path `/api/login` and `/api/register`, limit around 10 requests per 10 seconds per IP, action Block. (The free plan allows a small number of rules and short windows; check the form.) Without this, anyone can guess passwords at full speed or flood registrations.
- **Passwords:** the app accepts 4+ characters (as the old app did). Ask the Sheikh to use a long one; consider raising the minimum in `pass()` in `src/worker.js` and the form hints.
- **Student names are public on the login page** (the picker needs them). That matches the old app. If that is a privacy concern for your school, put the site behind Cloudflare Access.
- **Supabase free projects pause after about a week without activity.** The daily cron keeps it active.

## 6. Switching over from Netlify

1. Keep Netlify untouched until step 4 above passes with your *imported* data.
2. Point your domain (if you use one) at the Worker: Worker → Domains & Routes.
3. Tell users the new link. Sessions do not carry over, everyone logs in once.
4. A week later, delete the Netlify site and database.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Page loads, every action says "الموقع غير مهيّأ بعد" | secrets missing: see health check |
| Sheikh login says "لم يُضبط رمز دخول الشيخ" | `SHEIKH_PASSWORD` secret missing and no imported password |
| Everyone is logged out after a deploy | `SESSION_SECRET` changed or was never set |
| Login hangs or Cloudflare error 1102 ("exceeded CPU") | Password hashing costs CPU and the Free Workers plan allows very little per request. I could not measure this on Cloudflare itself. Fix: Workers Paid plan ($5/month), or lower `ITERATIONS` in `src/worker.js` (weaker hashes, still far better than plain text) |
| Saving a long plan fails on the free plan | should not happen (saves use one request); if it does, check the Worker logs |
| Fonts look different | Google Fonts (IBM Plex Sans Arabic, Amiri) could not load; the app falls back to system Arabic fonts |
| New student ids fail with "duplicate key" after import | `supabase/after-import.sql` was not run |
