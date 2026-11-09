# حلقة حمزة بن عبدالمطلب — Quran memorization circle manager

Arabic (RTL), mobile-first web app. The Sheikh oversees all groups, supervisors (مشرف) and muhaffizeen (محفظ) grade students, students follow their plan and debts.

**Stack:** Cloudflare Worker (serves the app + `/api/*` + a daily cron) · Supabase Postgres · plain HTML/CSS/JS (no build step, no dependencies besides `wrangler`).

- **Deploy and connect everything:** [`docs/SETUP.md`](docs/SETUP.md)
- Run the tests: `npm install && npm test`
- Preview with a fake in-memory database, no accounts needed: `npm run preview:fake` → http://localhost:8787 (Sheikh password `sheikh-pass`)

## Layout

| Path | What |
| --- | --- |
| `public/` | The app (static files). `js/lib/` is shared by browser and Worker. |
| `src/worker.js` | API, login/sessions, per-role permissions, debt cron |
| `supabase/schema.sql` | Tables, locked-down RLS, the debt function |
| `supabase/after-import.sql` | Only after importing old Netlify data |
| `test/` | Backend tests + a fake Supabase for local preview |

## Rules the server enforces

Lessons are graded strictly in order (only the current lesson can be «تم الحفظ», «لم يحفظ» only once its date has come, only the last done lesson can be undone). Anything not recited by 4 PM Riyadh becomes a debt. A student sees only their own plan, a مشرف only their group, a محفظ only assigned students, the Sheikh everything.

## Updating the semester

Edit the calendar in `public/js/lib/semester.js` (and the Hijri range text in `public/js/lib/msgs.js`).
