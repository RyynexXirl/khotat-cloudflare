import test from 'node:test'
import assert from 'node:assert/strict'
import worker, { checkPassword, hashPassword } from '../src/worker.js'
import { currentLesson, lastDoneLesson, openStatus } from '../public/js/lib/plan.js'
import { LESSON_DAYS, SEMESTER_DAYS, SEMESTER, hijriLabel } from '../public/js/lib/semester.js'
import { formatStudentName, parseAssignment } from '../public/js/lib/names.js'
import { startFakeSupabase } from './fake-supabase.mjs'

const fake = await startFakeSupabase()
test.after(() => fake.server.close())
const env = { SUPABASE_URL: fake.url, SUPABASE_SERVICE_KEY: fake.key, SESSION_SECRET: 's3cret-for-tests', SHEIKH_PASSWORD: 'sheikh-pass' }

/** Call the Worker like the browser would (cookie jar per client). */
function client() {
  let cookie = ''
  return async (method, path, body) => {
    const res = await worker.fetch(
      new Request(`https://khotat.test${path}`, { method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }),
      env,
    )
    const set = res.headers.get('set-cookie')
    if (set) cookie = set.split(';')[0]
    return { status: res.status, ...(await res.json()) }
  }
}

test('calendar and rules', () => {
  assert.equal(LESSON_DAYS.length, 52)
  assert.equal(SEMESTER.find((w) => w.number === 14).vacation, true)
  for (const d of SEMESTER_DAYS) {
    const p = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { timeZone: 'UTC', month: 'numeric', day: 'numeric' }).formatToParts(new Date(`${d.date}T00:00:00Z`))
    assert.equal(`${p.find((x) => x.type === 'month').value}/${p.find((x) => x.type === 'day').value}`, d.hijri, d.date)
  }
  assert.equal(hijriLabel('2026-08-30'), '3/17')
  assert.equal(formatStudentName('محمد عبدالله السبيعي'), 'محمد بن عبدالله السبيعي')
  assert.deepEqual(parseAssignment('سورة الحشر (21–24)'), { from: '21', to: '24', surah: 'الحشر' })
  const day = (n, status) => ({ id: n, day_number: n, date: LESSON_DAYS[n - 1].date, new_memorization: `درس ${n}`, review: '', status })
  const days = [day(1, 'done'), day(2, 'done'), day(3, 'pending')]
  assert.equal(currentLesson(days).id, 3)
  assert.equal(lastDoneLesson(days).id, 2)
  assert.equal(openStatus('2000-01-01'), 'debt')
})

test('passwords: hashed, and old plaintext upgrades', async () => {
  const h = await hashPassword('pw12')
  assert.equal(await checkPassword('pw12', h), 'ok')
  assert.equal(await checkPassword('nope', h), 'no')
  assert.equal(await checkPassword('1234', '1234'), 'upgrade')
  assert.equal(await checkPassword('x', '1234'), 'no')
})

test('health reports a working setup', async () => {
  const r = await client()('GET', '/api/health')
  assert.equal(r.ok, true)
  assert.equal(r.database, 'ok')
  const broken = await worker.fetch(new Request('https://khotat.test/api/health'), { ...env, SUPABASE_SERVICE_KEY: 'wrong' })
  assert.equal((await broken.json()).database, 'bad_key')
})

test('full flow: roles, permissions, grading order, debts', async () => {
  const sheikh = client()
  assert.equal((await sheikh('GET', '/api/overview')).status, 401)
  assert.equal((await sheikh('POST', '/api/login', { role: 'sheikh', password: 'wrong' })).status, 400)
  assert.equal((await sheikh('POST', '/api/login', { role: 'sheikh', password: 'sheikh-pass' })).session.role, 'sheikh')

  // Sheikh creates a supervisor (group 1) and a muhaffiz; the directory never leaks passwords.
  const sv = await sheikh('POST', '/api/supervisors', { name: 'أ. خالد', group_id: 1, password: 'sv-pass' })
  const mh = await sheikh('POST', '/api/muhaffizeen', { name: 'أ. فهد', phone: '', password: 'mh-pass' })
  const dir = await client()('GET', '/api/directory')
  assert.ok(!JSON.stringify(dir).includes('password') && !JSON.stringify(dir).includes('pbkdf2'))
  assert.equal(dir.supervisors.length, 1)

  // Two students self-register: one in the supervisor's group, one in another group.
  const reg = (name, group_id) => client()('POST', '/api/register', { name, group_id, password: 'abcd' })
  const a = await reg('عمر يوسف الحربي', 1)
  const b = await reg('سلمان فيصل العتيبي', 2)
  assert.equal(a.name, 'عمر بن يوسف الحربي')
  assert.equal(fake.store.t.plan_days.filter((d) => d.student_id === a.id).length, 52)
  assert.ok(fake.store.t.students[0].password.startsWith('pbkdf2$'))

  // Student logs in, sees only their own plan, cannot grade or read others.
  const stu = client()
  assert.equal((await stu('POST', '/api/login', { role: 'student', id: a.id, password: 'abcd' })).session.id, a.id)
  assert.equal((await stu('GET', `/api/plan/${a.id}`)).days.length, 52)
  assert.equal((await stu('GET', `/api/plan/${b.id}`)).status, 403)
  assert.equal((await stu('POST', '/api/grade', { day_id: 1, action: 'done' })).status, 403)
  assert.equal((await stu('GET', '/api/overview')).status, 403)

  // Supervisor writes a plan for student A, but cannot touch student B (other group).
  const sup = client()
  await sup('POST', '/api/login', { role: 'supervisor', id: sv.id, password: 'sv-pass' })
  assert.equal((await sup('GET', `/api/plan/${b.id}`)).status, 403)
  const plan = await sup('GET', `/api/plan/${a.id}`)
  const [d1, d2, d3] = plan.days
  await sup('PUT', `/api/plan/${a.id}`, { items: [d1, d2, d3].map((d, i) => ({ id: d.id, new_memorization: `سورة المجادلة (${i * 5 + 1}–${i * 5 + 5})`, review: '' })) })
  const sheet0 = await sup('GET', '/api/sheet')
  assert.equal(sheet0.rows.length, 1)
  assert.equal(sheet0.rows[0].total, 3)

  // Order is enforced: lesson 2 cannot be done before lesson 1; lesson 1 can (even ahead of its date).
  assert.equal((await sup('POST', '/api/grade', { day_id: d2.id, action: 'done' })).error, 'out_of_order')
  assert.equal((await sup('POST', '/api/grade', { day_id: d1.id, action: 'done' })).status, 'done')
  assert.equal((await sup('POST', '/api/grade', { day_id: d1.id, action: 'done' })).status, 'pending') // toggles off
  await sup('POST', '/api/grade', { day_id: d1.id, action: 'done' })
  assert.equal((await sup('POST', '/api/grade', { day_id: d2.id, action: 'missed' })).status, 'missed') // its date has passed
  assert.equal((await sup('POST', '/api/grade', { day_id: d2.id, action: 'missed' })).status, 'pending') // toggles off

  // A lesson dated in the future cannot be marked missed (the Sheikh may open any plan).
  const planB = await sheikh('GET', `/api/plan/${b.id}`)
  const last = planB.days.at(-1)
  await sheikh('PUT', `/api/plan/${b.id}`, { items: [{ id: last.id, new_memorization: 'سورة الصف (1–5)', review: '' }] })
  assert.equal((await sheikh('POST', '/api/grade', { day_id: last.id, action: 'missed' })).error, 'not_due')

  // The daily job turns due, ungraded lessons into debts (all three dates are in 2026-08/09; "now" is later).
  const run = await sheikh('POST', '/api/debts/run')
  assert.equal(run.marked, 2) // lessons 2 and 3 (lesson 1 is done)
  const ov = await sheikh('GET', '/api/overview')
  assert.equal(ov.totals.withDebts, 1)
  assert.equal(ov.students.find((s) => s.id === a.id).debts, 2)

  // Muhaffiz only sees assigned students.
  await sheikh('PATCH', `/api/students/${b.id}`, { muhaffiz_id: mh.id })
  const muh = client()
  await muh('POST', '/api/login', { role: 'muhaffiz', id: mh.id, password: 'mh-pass' })
  assert.deepEqual((await muh('GET', '/api/sheet')).rows.map((r) => r.student.id), [b.id])
  assert.equal((await muh('GET', `/api/plan/${a.id}`)).status, 403)

  // Password change works and the old one stops working.
  assert.equal((await stu('POST', '/api/password', { currentPassword: 'abcd', newPassword: 'new-pass' })).ok, true)
  assert.equal((await client()('POST', '/api/login', { role: 'student', id: a.id, password: 'abcd' })).status, 400)
  assert.equal((await client()('POST', '/api/login', { role: 'student', id: a.id, password: 'new-pass' })).status, 200)

  // Deleting a student removes their plan.
  await sheikh('DELETE', `/api/students/${b.id}`)
  assert.equal(fake.store.t.plan_days.some((d) => d.student_id === b.id), false)
})

test('legacy plaintext passwords from the old app still log in, then get hashed', async () => {
  fake.store.t.students.push({ id: 900, name: 'قديم', group_id: 1, subgroup: null, phone: '', password: '1234', muhaffiz_id: null })
  fake.store.t.settings.push({ key: 'sheikh_password', value: 'old-plain' })
  const c = client()
  assert.equal((await c('POST', '/api/login', { role: 'student', id: 900, password: '1234' })).status, 200)
  assert.ok(fake.store.t.students.find((s) => s.id === 900).password.startsWith('pbkdf2$'))
  assert.equal((await client()('POST', '/api/login', { role: 'sheikh', password: 'old-plain' })).status, 200)
  assert.ok(fake.store.t.settings[0].value.startsWith('pbkdf2$'))
  assert.equal((await client()('POST', '/api/login', { role: 'sheikh', password: 'old-plain' })).status, 200) // still works hashed
})
