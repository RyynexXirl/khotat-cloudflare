// A tiny in-memory stand-in for Supabase's PostgREST, covering only the query shapes the Worker uses.
// Used by the tests and by `npm run preview:fake`. Not a Postgres: it just lets the app run without one.
import http from 'node:http'
import { LESSON_DAYS } from '../public/js/lib/semester.js'

const KEY = 'fake-secret-key'
const IDENTITY = new Set(['groups', 'supervisors', 'muhaffizeen', 'students', 'plan_days'])
const DEFAULTS = {
  muhaffizeen: { phone: '' },
  students: { subgroup: null, phone: '', muhaffiz_id: null },
  plan_days: { new_memorization: '', review: '', status: 'pending' },
}

export function createStore() {
  const t = { settings: [], groups: [], supervisors: [], muhaffizeen: [], students: [], plan_days: [] }
  const next = Object.fromEntries([...IDENTITY].map((n) => [n, 1]))
  ;[['الأجاويد'], ['الارتقاء'], ['الثبات']].forEach(([name]) => t.groups.push({ id: next.groups++, name }))
  return { t, next }
}

function matches(row, [col, expr]) {
  const dot = expr.indexOf('.')
  const op = expr.slice(0, dot)
  const raw = expr.slice(dot + 1)
  const v = row[col]
  const num = (x) => (typeof v === 'number' ? Number(x) : x)
  if (op === 'eq') return String(v) === raw
  if (op === 'in') return raw.slice(1, -1).split(',').includes(String(v))
  if (op === 'lt') return v < num(raw)
  if (op === 'lte') return v <= num(raw)
  throw new Error(`fake-supabase: unsupported filter ${col}=${expr}`)
}

export function startFakeSupabase(store = createStore(), port = 0) {
  const { t, next } = store
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    const send = (status, data) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(data === undefined ? '' : JSON.stringify(data))
    }
    if (req.headers.apikey !== KEY) return send(401, { message: 'Invalid API key' })
    let raw = ''
    for await (const c of req) raw += c
    const body = raw ? JSON.parse(raw) : undefined
    const m = /^\/rest\/v1\/(rpc\/)?(\w+)$/.exec(url.pathname)
    if (!m) return send(404, {})
    const [, isRpc, name] = m

    if (isRpc) {
      if (name !== 'mark_ungraded_as_debt') return send(404, {})
      let n = 0
      for (const d of t.plan_days) {
        const due = body.p_include_today ? d.date <= body.p_today : d.date < body.p_today
        if (d.status === 'pending' && (d.new_memorization.trim() || d.review.trim()) && due) (d.status = 'debt'), n++
      }
      return send(200, n)
    }
    if (!t[name]) return send(404, { code: 'PGRST205', message: `Could not find the table 'public.${name}'` })

    const params = [...url.searchParams.entries()]
    const filters = params.filter(([k]) => !['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k))
    const rows = t[name].filter((r) => filters.every((f) => matches(r, f)))

    if (req.method === 'GET') {
      const order = (url.searchParams.get('order') ?? 'id.asc').split(',').map((o) => o.split('.'))
      const sorted = [...rows].sort((a, b) => {
        for (const [col, dir] of order) if (a[col] !== b[col]) return (a[col] < b[col] ? -1 : 1) * (dir === 'desc' ? -1 : 1)
        return 0
      })
      const offset = Number(url.searchParams.get('offset') ?? 0)
      const limit = Number(url.searchParams.get('limit') ?? 1000)
      return send(200, sorted.slice(offset, offset + Math.min(limit, 1000)))
    }
    if (req.method === 'POST') {
      const list = Array.isArray(body) ? body : [body]
      const onConflict = url.searchParams.get('on_conflict')
      const out = list.map((row) => {
        const existing = onConflict && t[name].find((r) => r[onConflict] === row[onConflict])
        if (existing) return Object.assign(existing, row)
        const full = { ...DEFAULTS[name], ...row }
        if (IDENTITY.has(name) && full.id === undefined) full.id = next[name]++
        if (name === 'students' && !t.groups.some((g) => g.id === full.group_id)) throw new Error('fk')
        t[name].push(full)
        return full
      })
      return send(201, out)
    }
    if (req.method === 'PATCH') {
      rows.forEach((r) => Object.assign(r, body))
      return send(200, rows)
    }
    if (req.method === 'DELETE') {
      t[name] = t[name].filter((r) => !rows.includes(r))
      if (name === 'students') t.plan_days = t.plan_days.filter((d) => t.students.some((s) => s.id === d.student_id))
      if (name === 'muhaffizeen') t.students.forEach((s) => rows.some((r) => r.id === s.muhaffiz_id) && (s.muhaffiz_id = null))
      return send(204)
    }
    send(405, {})
  })
  return new Promise((resolve) =>
    server.listen(port, '127.0.0.1', () => resolve({ server, store, url: `http://127.0.0.1:${server.address().port}`, key: KEY })),
  )
}

export { LESSON_DAYS }
