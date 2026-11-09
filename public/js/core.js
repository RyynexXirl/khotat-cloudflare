// Session state, API client and the tiny router hook shared by every view.
import { toast } from './ui.js'
import { t } from './lib/msgs.js'

export const state = { session: null }
export const ROLE_HOME = { sheikh: '/sheikh', supervisor: '/supervisor', muhaffiz: '/muhaffiz', student: '/student' }

export class ApiError extends Error {
  constructor(code, status) {
    super(code)
    this.code = code
    this.status = status
  }
}

let navigate = () => {}
export const setNavigate = (fn) => (navigate = fn)
export const go = (path, replace = false) => navigate(path, replace)

export async function api(path, { method = 'GET', body } = {}) {
  let res
  try {
    res = await fetch(path, { method, credentials: 'same-origin', headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  } catch {
    throw new ApiError('network', 0)
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401 && state.session) {
      state.session = null
      go('/', true)
      toast(t.errors.unauthorized, 'bad')
    }
    throw new ApiError(data.error ?? 'server_error', res.status)
  }
  return data
}
