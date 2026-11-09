// Khotat on Cloudflare: one Worker serves the static app (public/) and the JSON API (/api/*),
// stores data in Supabase (PostgREST over fetch, no dependencies) and runs the daily debt cron.
//
// Secrets (wrangler secret put …): SUPABASE_URL, SUPABASE_SERVICE_KEY, SESSION_SECRET, SHEIKH_PASSWORD.

import { AJAWID, SUBGROUPS, formatStudentName } from '../public/js/lib/names.js'
import { currentHour, currentLesson, DEBT_CUTOFF_HOUR, hasContent, lastDoneLesson, openStatus, progressOf, todayIso } from '../public/js/lib/plan.js'
import { LESSON_DAYS } from '../public/js/lib/semester.js'

class HttpError extends Error {
  constructor(code, status = 400) {
    super(code)
    this.code = code
    this.status = status
  }
}
const bad = (code, status = 400) => new HttpError(code, status)

// ───────────────────────── passwords and sessions ─────────────────────────

const te = new TextEncoder()
const td = new TextDecoder()
const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
const unb64u = (s) => Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0))

// shortcut: 50k PBKDF2 rounds keeps login inside Workers' CPU budget; the count is stored in each
// hash, so raise it here whenever the plan allows and old hashes keep working.
const ITERATIONS = 50_000

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256))
}

function same(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return `pbkdf2$${ITERATIONS}$${b64u(salt)}$${b64u(await derive(password, salt, ITERATIONS))}`
}

/** 'ok' · 'upgrade' (right password still stored in plain text by the old app: re-save it hashed) · 'no' */
export async function checkPassword(password, stored) {
  if (stored.startsWith('pbkdf2$')) {
    const [, iterations, salt, hash] = stored.split('$')
    return same(await derive(password, unb64u(salt), Number(iterations)), unb64u(hash)) ? 'ok' : 'no'
  }
  return same(te.encode(password), te.encode(stored)) ? 'upgrade' : 'no'
}

const COOKIE = 'khotat_session'
const MAX_AGE = 60 * 60 * 24 * 30
const hmacKey = (secret, usage) => crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage])

async function makeToken(session, secret) {
  const body = b64u(te.encode(JSON.stringify({ ...session, exp: Math.floor(Date.now() / 1000) + MAX_AGE })))
  return `${body}.${b64u(await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), te.encode(body)))}`
}

async function readToken(token, secret) {
  const [body, sig] = (token ?? '').split('.')
  if (!body || !sig) return null
  try {
    if (!(await crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), unb64u(sig), te.encode(body)))) return null
    const s = JSON.parse(td.decode(unb64u(body)))
    return s.exp > Date.now() / 1000 ? { role: s.role, id: s.id, name: s.name } : null
  } catch {
    return null
  }
}

// ───────────────────────── Supabase (PostgREST) ─────────────────────────

const eq = (v) => `eq.${v}`
const inList = (ids) => `in.(${ids.join(',')})`

function makeDb(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) throw bad('not_configured', 503)
  const base = `${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1`
  const key = env.SUPABASE_SERVICE_KEY
  const headers = { apikey: key, 'content-type': 'application/json' }
  // Legacy service_role keys are JWTs and also go in Authorization; new sb_secret_… keys go in apikey only.
  if (key.startsWith('eyJ')) headers.authorization = `Bearer ${key}`

  async function call(method, path, body, prefer) {
    const res = await fetch(base + path, {
      method,
      headers: prefer ? { ...headers, prefer } : headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    if (!res.ok) throw Object.assign(new Error(`Supabase ${method} ${path.split('?')[0]} → ${res.status} ${text.slice(0, 300)}`), { upstream: res.status })
    return text ? JSON.parse(text) : null
  }
  const qs = (f) => Object.entries(f).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
  const PAGE = 1000 // PostgREST returns at most 1000 rows per request

  return {
    /** Every matching row, paging through the 1000-row cap. Pass order: for tables without an id column. */
    async get(table, filters = {}) {
      const out = []
      for (let offset = 0; ; offset += PAGE) {
        const rows = await call('GET', `/${table}?${qs({ order: 'id.asc', ...filters, limit: PAGE, offset })}`)
        out.push(...rows)
        if (rows.length < PAGE) return out
      }
    },
    insert: (table, rows) => call('POST', `/${table}`, rows, 'return=representation'),
    upsert: (table, rows, onConflict) => call('POST', `/${table}?on_conflict=${onConflict}`, rows, 'resolution=merge-duplicates,return=representation'),
    update: (table, filters, patch) => call('PATCH', `/${table}?${qs(filters)}`, patch, 'return=representation'),
    remove: (table, filters) => call('DELETE', `/${table}?${qs(filters)}`),
    rpc: (fn, args) => call('POST', `/rpc/${fn}`, args),
  }
}

// ───────────────────────── validation ─────────────────────────

const str = (v, min, max) => {
  const s = typeof v === 'string' ? v.trim() : ''
  if (s.length < min || s.length > max) throw bad('invalid')
  return s
}
const int = (v) => {
  if (!Number.isInteger(v)) throw bad('invalid')
  return v
}
const pass = (v, min = 4) => {
  if (typeof v !== 'string' || v.length < min || v.length > 60) throw bad(min > 0 ? 'weak_password' : 'invalid')
  return v
}
const TABLE = { supervisor: 'supervisors', muhaffiz: 'muhaffizeen', student: 'students' }
const byName = (a, b) => a.name.localeCompare(b.name, 'ar')
const groupBy = (rows, key) => {
  const map = new Map()
  for (const r of rows) map.set(r[key], [...(map.get(r[key]) ?? []), r])
  return map
}
const DAY_COLUMNS = 'id,student_id,day_number,date,new_memorization,review,status'

// ───────────────────────── shared logic ─────────────────────────

async function seedPlan(db, studentId) {
  await db.insert('plan_days', LESSON_DAYS.map((d, i) => ({ student_id: studentId, day_number: i + 1, date: d.date })))
}

/** The Sheikh's password: the hashed (or still plain) value in settings, else the SHEIKH_PASSWORD secret. */
async function sheikhPasswordOk(db, env, password) {
  const [row] = await db.get('settings', { key: eq('sheikh_password'), order: 'key.asc' })
  if (row) {
    const result = await checkPassword(password, row.value)
    if (result === 'upgrade') await db.update('settings', { key: eq('sheikh_password') }, { value: await hashPassword(password) })
    return result !== 'no'
  }
  if (!env.SHEIKH_PASSWORD) throw bad('sheikh_not_configured', 503)
  return same(te.encode(password), te.encode(env.SHEIKH_PASSWORD))
}

/** The student row, if this session may see it. */
async function studentFor({ db, session }, id) {
  const [s] = await db.get('students', { id: eq(id) })
  if (!s) throw bad('not_found', 404)
  const { role } = session
  if (role === 'sheikh' || (role === 'student' && s.id === session.id) || (role === 'muhaffiz' && s.muhaffiz_id === session.id)) return s
  if (role === 'supervisor') {
    const [sv] = await db.get('supervisors', { id: eq(session.id) })
    if (sv?.group_id === s.group_id) return s
  }
  throw bad('forbidden', 403)
}

/** Everyone a staff session may work with: all (Sheikh), a group (مشرف) or the assigned (محفظ). */
async function scope({ db, session }) {
  if (session.role === 'sheikh') return { students: await db.get('students') }
  if (session.role === 'supervisor') {
    const [who] = await db.get('supervisors', { id: eq(session.id) })
    if (!who) throw bad('unauthorized', 401)
    return { who, students: await db.get('students', { group_id: eq(who.group_id) }) }
  }
  if (session.role === 'muhaffiz') {
    const [who] = await db.get('muhaffizeen', { id: eq(session.id) })
    if (!who) throw bad('unauthorized', 401)
    return { who, students: await db.get('students', { muhaffiz_id: eq(who.id) }) }
  }
  throw bad('forbidden', 403)
}

const loadDays = (db, studentId) => db.get('plan_days', { student_id: eq(studentId), order: 'day_number.asc' })

/**
 * Grade one lesson, enforcing the order. done: only the current lesson (may be ahead of its date).
 * missed: only the current lesson, once its date has come. undo: only the last done lesson.
 * Clicking an active grade again toggles it back to pending.
 */
async function gradeOne(db, row, action, now) {
  if (!hasContent(row)) return 'empty'
  const days = await loadDays(db, row.student_id)
  const set = (status) => db.update('plan_days', { id: eq(row.id) }, { status, updated_at: now.toISOString() })
  if (action === 'undo') {
    if (lastDoneLesson(days)?.id !== row.id) return 'not_last'
    await set(openStatus(row.date, now))
    return null
  }
  if (action === 'done' && row.status === 'done') {
    if (lastDoneLesson(days)?.id !== row.id) return 'not_last'
    await set('pending')
    return null
  }
  if (currentLesson(days)?.id !== row.id) return 'out_of_order'
  if (action === 'missed') {
    if (row.status === 'missed') {
      await set('pending')
      return null
    }
    if (row.date > todayIso(now)) return 'not_due'
    await set('missed')
    return null
  }
  await set('done')
  return null
}

export async function markUngradedAsDebt(db, now = new Date()) {
  const today = todayIso(now)
  const includeToday = currentHour(now) >= DEBT_CUTOFF_HOUR
  const marked = await db.rpc('mark_ungraded_as_debt', { p_today: today, p_include_today: includeToday })
  return { marked, today, includeToday }
}

// ───────────────────────── routes ─────────────────────────

const routes = []
const STAFF = ['sheikh', 'supervisor', 'muhaffiz']
const ANY = ['sheikh', 'supervisor', 'muhaffiz', 'student']
/** roles: null = public, otherwise the roles allowed. Path params are numeric ids. */
const route = (method, pattern, roles, fn) =>
  routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>\\d+)')}$`), roles, fn })

route('GET', '/api/health', null, async (ctx) => {
  const configured = {
    supabase: Boolean(ctx.env.SUPABASE_URL && ctx.env.SUPABASE_SERVICE_KEY),
    session_secret: Boolean(ctx.env.SESSION_SECRET),
    sheikh_password: Boolean(ctx.env.SHEIKH_PASSWORD),
  }
  let database = 'not_configured'
  if (configured.supabase) {
    try {
      // Proves the URL, the key, the schema and the cron function in one call; before 1970 nothing matches, so it changes nothing.
      await makeDb(ctx.env).rpc('mark_ungraded_as_debt', { p_today: '1970-01-01', p_include_today: false })
      database = 'ok'
    } catch (e) {
      database = e.upstream === 401 || e.upstream === 403 ? 'bad_key' : e.upstream === 404 ? 'schema_missing' : 'unreachable'
    }
  }
  const ok = database === 'ok' && configured.session_secret
  return { ok, database, configured, riyadh_today: todayIso(ctx.now) }
})

route('GET', '/api/me', null, ({ session }) => ({ session }))

route('GET', '/api/directory', null, async ({ db }) => {
  const [groups, supervisors, muhaffizeen, students] = await Promise.all(['groups', 'supervisors', 'muhaffizeen', 'students'].map((t) => db.get(t)))
  return {
    groups,
    supervisors: supervisors.map(({ id, name, group_id }) => ({ id, name, group_id })).sort(byName),
    muhaffizeen: muhaffizeen.map(({ id, name }) => ({ id, name })).sort(byName),
    students: students.map(({ id, name, group_id }) => ({ id, name, group_id })).sort(byName),
  }
})

route('POST', '/api/login', null, async ({ db, env, body, headers, secure }) => {
  if (!env.SESSION_SECRET) throw bad('not_configured', 503)
  const password = typeof body.password === 'string' && body.password.length <= 200 ? body.password : ''
  let session
  if (body.role === 'sheikh') {
    if (!(await sheikhPasswordOk(db, env, password))) throw bad('wrong_password')
    session = { role: 'sheikh', id: 0, name: 'الشيخ' }
  } else {
    const table = TABLE[body.role]
    if (!table) throw bad('invalid')
    const [row] = await db.get(table, { id: eq(int(body.id)) })
    if (!row) throw bad('not_found', 404)
    const result = await checkPassword(password, row.password)
    if (result === 'no') throw bad('wrong_credentials')
    if (result === 'upgrade') await db.update(table, { id: eq(row.id) }, { password: await hashPassword(password) })
    session = { role: body.role, id: row.id, name: row.name }
  }
  headers.append('set-cookie', `${COOKIE}=${await makeToken(session, env.SESSION_SECRET)}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`)
  return { session }
})

route('POST', '/api/logout', null, ({ headers, secure }) => {
  headers.append('set-cookie', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`)
  return { ok: true }
})

route('POST', '/api/register', null, async ({ db, body }) => {
  const name = formatStudentName(str(body.name, 2, 80))
  const password = pass(body.password)
  const phone = body.phone ? str(body.phone, 0, 20) : ''
  const [group] = await db.get('groups', { id: eq(int(body.group_id)) })
  if (!group) throw bad('not_found', 404)
  const subgroup = group.name === AJAWID && SUBGROUPS.includes(body.subgroup) ? body.subgroup : null
  const [s] = await db.insert('students', { name, group_id: group.id, subgroup, phone, password: await hashPassword(password) })
  await seedPlan(db, s.id)
  return { id: s.id, name: s.name, group_id: s.group_id }
})

route('POST', '/api/password', ANY, async ({ db, env, body, session }) => {
  const current = pass(body.currentPassword, 0)
  const next = pass(body.newPassword)
  if (session.role === 'sheikh') {
    if (!(await sheikhPasswordOk(db, env, current))) throw bad('wrong_password')
    await db.upsert('settings', { key: 'sheikh_password', value: await hashPassword(next) }, 'key')
  } else {
    const table = TABLE[session.role]
    const [row] = await db.get(table, { id: eq(session.id) })
    if (!row) throw bad('not_found', 404)
    if ((await checkPassword(current, row.password)) === 'no') throw bad('wrong_password')
    await db.update(table, { id: eq(row.id) }, { password: await hashPassword(next) })
  }
  return { ok: true }
})

// ── Sheikh ──

route('GET', '/api/overview', ['sheikh'], async ({ db, now }) => {
  const today = todayIso(now)
  const [students, groups, supervisors, muhaffizeen, days] = await Promise.all([
    db.get('students'),
    db.get('groups'),
    db.get('supervisors'),
    db.get('muhaffizeen'),
    db.get('plan_days', { select: DAY_COLUMNS }),
  ])
  const plans = groupBy(days, 'student_id')
  const groupName = new Map(groups.map((g) => [g.id, g.name]))
  const mhName = new Map(muhaffizeen.map((m) => [m.id, m.name]))
  const rows = students
    .map((s) => {
      const p = progressOf(plans.get(s.id) ?? [], today)
      return {
        id: s.id,
        name: s.name,
        group_id: s.group_id,
        group_name: groupName.get(s.group_id) ?? '',
        subgroup: s.subgroup,
        muhaffiz_id: s.muhaffiz_id,
        muhaffiz_name: mhName.get(s.muhaffiz_id) ?? null,
        total: p.total,
        done: p.done,
        debts: p.debts,
      }
    })
    .sort((a, b) => a.group_id - b.group_id || byName(a, b))
  return {
    students: rows,
    groups: groups.map((g) => ({ ...g, supervisor: supervisors.find((s) => s.group_id === g.id)?.name ?? '' })),
    supervisors: supervisors.map(({ id, name, group_id }) => ({ id, name, group_id })),
    muhaffizeen: muhaffizeen.map(({ id, name, phone }) => ({ id, name, phone, assigned: rows.filter((r) => r.muhaffiz_id === id).length })).sort(byName),
    totals: {
      students: rows.length,
      withDebts: rows.filter((r) => r.debts > 0).length,
      totalDebtDays: rows.reduce((a, r) => a + r.debts, 0),
    },
  }
})

function subgroupOf(v) {
  if (v == null || v === '') return null
  if (!SUBGROUPS.includes(v)) throw bad('invalid')
  return v
}

route('POST', '/api/students', ['sheikh'], async ({ db, body }) => {
  const name = formatStudentName(str(body.name, 2, 80))
  const [group] = await db.get('groups', { id: eq(int(body.group_id)) })
  if (!group) throw bad('not_found', 404)
  const subgroup = group.name === AJAWID ? subgroupOf(body.subgroup) : null
  // New students start on 1234 (as in the old app) until they change it themselves.
  const password = await hashPassword(body.password ? pass(body.password) : '1234')
  const [s] = await db.insert('students', { name, group_id: group.id, subgroup, password })
  await seedPlan(db, s.id)
  return { id: s.id, name: s.name }
})

route('PATCH', '/api/students/:id', ['sheikh'], async ({ db, body, params }) => {
  const patch = {}
  let groupName
  if (body.name !== undefined) patch.name = formatStudentName(str(body.name, 2, 80))
  if (body.group_id !== undefined) {
    const [group] = await db.get('groups', { id: eq(int(body.group_id)) })
    if (!group) throw bad('not_found', 404)
    patch.group_id = group.id
    groupName = group.name
  }
  if (body.subgroup !== undefined) patch.subgroup = (groupName ?? AJAWID) === AJAWID ? subgroupOf(body.subgroup) : null
  if (body.muhaffiz_id !== undefined) {
    if (body.muhaffiz_id !== null && !(await db.get('muhaffizeen', { id: eq(int(body.muhaffiz_id)) })).length) throw bad('not_found', 404)
    patch.muhaffiz_id = body.muhaffiz_id
  }
  if (Object.keys(patch).length) await db.update('students', { id: eq(params.id) }, patch)
  return { ok: true }
})

route('DELETE', '/api/students/:id', ['sheikh'], async ({ db, params }) => {
  await db.remove('students', { id: eq(params.id) }) // plan_days go with it (on delete cascade)
  return { ok: true }
})

route('POST', '/api/supervisors', ['sheikh'], async ({ db, body }) => {
  const [group] = await db.get('groups', { id: eq(int(body.group_id)) })
  if (!group) throw bad('not_found', 404)
  const [sv] = await db.insert('supervisors', { name: str(body.name, 2, 80), group_id: group.id, password: await hashPassword(pass(body.password)) })
  return { id: sv.id, name: sv.name }
})

route('DELETE', '/api/supervisors/:id', ['sheikh'], async ({ db, params }) => {
  await db.remove('supervisors', { id: eq(params.id) })
  return { ok: true }
})

route('POST', '/api/muhaffizeen', ['sheikh'], async ({ db, body }) => {
  const phone = body.phone ? str(body.phone, 0, 20) : ''
  const [m] = await db.insert('muhaffizeen', { name: str(body.name, 2, 80), phone, password: await hashPassword(pass(body.password)) })
  return { id: m.id, name: m.name }
})

route('DELETE', '/api/muhaffizeen/:id', ['sheikh'], async ({ db, params }) => {
  await db.remove('muhaffizeen', { id: eq(params.id) }) // students.muhaffiz_id is set to null by the foreign key
  return { ok: true }
})

route('POST', '/api/debts/run', ['sheikh'], ({ db, now }) => markUngradedAsDebt(db, now))

// ── Plans ──

route('GET', '/api/plan/:id', ANY, async (ctx) => {
  const { db, session, params } = ctx
  const s = await studentFor(ctx, params.id)
  const [[group], days, supervisors] = await Promise.all([db.get('groups', { id: eq(s.group_id) }), loadDays(db, s.id), db.get('supervisors', { group_id: eq(s.group_id) })])
  const classmates = session.role === 'student' ? [] : (await scope(ctx)).students.filter((c) => c.id !== s.id).map(({ id, name }) => ({ id, name })).sort(byName)
  return {
    student: { id: s.id, name: s.name, group_id: s.group_id, group_name: group?.name ?? '', subgroup: s.subgroup },
    supervisor: supervisors[0]?.name ?? '',
    days,
    today: todayIso(ctx.now),
    classmates,
  }
})

route('PUT', '/api/plan/:id', STAFF, async (ctx) => {
  const { db, body, params, now } = ctx
  await studentFor(ctx, params.id)
  if (!Array.isArray(body.items) || body.items.length > 200) throw bad('invalid')
  const days = await loadDays(db, params.id)
  const byId = new Map(days.map((d) => [d.id, d]))
  const rows = body.items.flatMap((it) => {
    const d = byId.get(int(it.id))
    return d ? [{ ...d, new_memorization: str(it.new_memorization, 0, 300), review: str(it.review, 0, 300), updated_at: now.toISOString() }] : []
  })
  if (rows.length) await db.upsert('plan_days', rows, 'id') // one request, however many days changed
  return loadDays(db, params.id)
})

route('POST', '/api/plan/:id/copy', STAFF, async (ctx) => {
  const { db, body, params, now } = ctx
  await studentFor(ctx, params.id)
  const from = int(body.from_student_id)
  await studentFor(ctx, from)
  const [source, target] = await Promise.all([loadDays(db, from), loadDays(db, params.id)])
  const byDay = new Map(source.map((d) => [d.day_number, d]))
  const rows = target.flatMap((d) => {
    const src = byDay.get(d.day_number)
    return src ? [{ ...d, new_memorization: src.new_memorization, review: src.review, updated_at: now.toISOString() }] : []
  })
  if (rows.length) await db.upsert('plan_days', rows, 'id')
  return loadDays(db, params.id)
})

route('POST', '/api/grade', STAFF, async (ctx) => {
  const { db, body, now } = ctx
  const action = body.action
  if (!['done', 'missed', 'undo'].includes(action)) throw bad('invalid')
  const [row] = await db.get('plan_days', { id: eq(int(body.day_id)) })
  if (!row) return { ok: false, error: 'not_found', status: null, days: [] }
  await studentFor(ctx, row.student_id)
  const error = await gradeOne(db, row, action, now)
  const days = await loadDays(db, row.student_id)
  return { ok: !error, error, status: days.find((d) => d.id === row.id)?.status ?? null, days }
})

// ── Grading sheets (مشرف and محفظ) ──

route('GET', '/api/sheet', ['supervisor', 'muhaffiz'], async (ctx) => {
  const { db, now } = ctx
  const { who, students } = await scope(ctx)
  const today = todayIso(now)
  const plans = groupBy(students.length ? await db.get('plan_days', { student_id: inList(students.map((s) => s.id)), select: DAY_COLUMNS }) : [], 'student_id')
  const groupIds = [...new Set(students.map((s) => s.group_id))]
  const groups = ctx.session.role === 'supervisor' ? await db.get('groups', { id: eq(who.group_id) }) : groupIds.length ? await db.get('groups', { id: inList(groupIds) }) : []
  return {
    who: { id: who.id, name: who.name },
    groups,
    today,
    hour: currentHour(now),
    rows: students.sort(byName).map((s) => {
      const days = plans.get(s.id) ?? []
      return { student: { id: s.id, name: s.name }, ...progressOf(days, today), lastDone: lastDoneLesson(days) ?? null }
    }),
  }
})

route('POST', '/api/sheet/all', ['supervisor', 'muhaffiz'], async (ctx) => {
  const { db, now } = ctx
  const { students } = await scope(ctx)
  if (!students.length) return { count: 0 }
  const today = todayIso(now)
  const plans = groupBy(await db.get('plan_days', { student_id: inList(students.map((s) => s.id)), select: DAY_COLUMNS }), 'student_id')
  // Only lessons that are due: "mark all" never pushes anyone ahead of the calendar.
  const ids = students.map((s) => currentLesson(plans.get(s.id) ?? [])).filter((d) => d && d.date <= today).map((d) => d.id)
  if (ids.length) await db.update('plan_days', { id: inList(ids) }, { status: 'done', updated_at: now.toISOString() })
  return { count: ids.length }
})

// ───────────────────────── entry points ─────────────────────────

async function handle(request, env) {
  const url = new URL(request.url)
  const found = routes.find((r) => r.method === request.method && r.re.test(url.pathname))
  if (!found) throw bad('not_found', 404)

  const origin = request.headers.get('origin')
  if (request.method !== 'GET' && origin && origin !== url.origin) throw bad('forbidden', 403)

  const cookie = /(?:^|;\s*)khotat_session=([^;]+)/.exec(request.headers.get('cookie') ?? '')?.[1]
  const session = env.SESSION_SECRET ? await readToken(cookie, env.SESSION_SECRET) : null
  if (found.roles) {
    if (!session) throw bad('unauthorized', 401)
    if (!found.roles.includes(session.role)) throw bad('forbidden', 403)
  }

  let body = {}
  if (request.method !== 'GET') {
    const parsed = await request.json().catch(() => null)
    body = parsed && typeof parsed === 'object' ? parsed : {}
  }
  const headers = new Headers({ 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  const ctx = {
    env,
    body,
    session,
    headers,
    now: new Date(),
    secure: url.protocol === 'https:',
    params: Object.fromEntries(Object.entries(found.re.exec(url.pathname).groups ?? {}).map(([k, v]) => [k, Number(v)])),
    get db() {
      const db = makeDb(env)
      Object.defineProperty(this, 'db', { value: db })
      return db
    },
  }
  return Response.json(await found.fn(ctx), { headers })
}

export default {
  async fetch(request, env) {
    if (!new URL(request.url).pathname.startsWith('/api/')) return env.ASSETS.fetch(request)
    try {
      return await handle(request, env)
    } catch (e) {
      const known = e instanceof HttpError
      if (!known) console.error(e)
      return Response.json({ error: known ? e.code : 'server_error' }, { status: known ? e.status : 500, headers: { 'cache-control': 'no-store' } })
    }
  },

  // Cron "0 13 * * *" (UTC) = 4:00 PM in Riyadh: every ungraded lesson that is due becomes a debt.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      markUngradedAsDebt(makeDb(env), new Date(event.scheduledTime)).then((r) => console.log(`[auto-debt] marked ${r.marked} lesson(s) as debt for ${r.today}`)),
    )
  },
}
