// Router: path-based (the Worker serves index.html for every non-API path).
import { api, state, setNavigate, ROLE_HOME } from './core.js'
import { loginView } from './views/login.js'
import { sheikhView } from './views/sheikh.js'
import { sheetView } from './views/sheet.js'
import { studentView } from './views/student.js'
import { planView } from './views/plan.js'

const root = document.getElementById('app')
const STAFF = ['sheikh', 'supervisor', 'muhaffiz']
const routes = [
  [/^\/$/, null, loginView],
  [/^\/sheikh$/, ['sheikh'], sheikhView],
  [/^\/supervisor$/, ['supervisor'], sheetView],
  [/^\/muhaffiz$/, ['muhaffiz'], sheetView],
  [/^\/student$/, ['student'], studentView],
  [/^\/plan\/(\d+)$/, STAFF, (r, id) => planView(r, Number(id))],
]

function render() {
  const path = location.pathname.replace(/\/+$/, '') || '/'
  for (const [re, roles, view] of routes) {
    const m = re.exec(path)
    if (!m) continue
    const role = state.session?.role
    if (!roles && role) return navigate(ROLE_HOME[role], true) // already signed in: skip the login page
    if (roles && !roles.includes(role)) return navigate(role ? ROLE_HOME[role] : '/', true)
    view(root, ...m.slice(1))
    window.scrollTo(0, 0)
    return
  }
  navigate('/', true)
}

function navigate(path, replace = false) {
  history[replace ? 'replaceState' : 'pushState'](null, '', path)
  render()
}
setNavigate(navigate)

document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a[data-link]')
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return
  e.preventDefault()
  navigate(new URL(a.href).pathname)
})
addEventListener('popstate', render)

// Learn who is signed in (the session lives in an HttpOnly cookie), then draw.
api('/api/me').then((r) => (state.session = r.session), () => {}).finally(render)
