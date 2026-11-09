// Local preview with NO Supabase and NO Cloudflare: static app + the real Worker + the in-memory fake database.
// `npm run preview:fake`, then open http://localhost:8787 (Sheikh password: sheikh-pass). Data resets on restart.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import worker from '../src/worker.js'
import { startFakeSupabase } from './fake-supabase.mjs'

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' }
const fake = await startFakeSupabase()
const env = {
  SUPABASE_URL: fake.url, SUPABASE_SERVICE_KEY: fake.key, SESSION_SECRET: 'local-preview-secret', SHEIKH_PASSWORD: 'sheikh-pass',
  // Mimics Workers Static Assets with single-page-application fallback.
  ASSETS: { fetch: async (req) => {
    const p = decodeURIComponent(new URL(req.url).pathname)
    let file = path.join(PUBLIC, p)
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html')
    return new Response(fs.readFileSync(file), { headers: { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' } })
  } },
}
const port = Number(process.env.PORT ?? 8787)
http.createServer(async (req, res) => {
  const chunks = []
  for await (const c of req) chunks.push(c)
  const r = await worker.fetch(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }), env)
  const headers = Object.fromEntries(r.headers)
  const cookies = r.headers.getSetCookie?.() ?? []
  if (cookies.length) headers['set-cookie'] = cookies
  res.writeHead(r.status, headers)
  res.end(Buffer.from(await r.arrayBuffer()))
}).listen(port, () => console.log(`Preview on http://localhost:${port}  (Sheikh password: sheikh-pass; fake data resets on restart)`))
