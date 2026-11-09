// Small DOM toolkit: no framework, no innerHTML with data (text goes in as text nodes).
import { t, errText } from './lib/msgs.js'

export function h(tag, props, ...kids) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue
    if (k === 'class') el.className = v
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
    else if (k in el && k !== 'list') el[k] = v
    else el.setAttribute(k, v === true ? '' : v)
  }
  el.append(...kids.flat(Infinity).filter((k) => k != null && k !== false))
  return el
}

const ICONS = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  checks: '<path d="M18 6 7 17l-5-5M22 10l-7.5 7.5L13 16"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  repeat: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  chevron: '<path d="m15 18-6-6 6-6"/>',
  arrow: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  dashed: '<circle cx="12" cy="12" r="9" stroke-dasharray="3 3"/>',
}

/** Icons are static markup from the table above, never user data. */
export function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  s.setAttribute('viewBox', '0 0 24 24')
  s.setAttribute('class', 'i')
  s.setAttribute('aria-hidden', 'true')
  s.innerHTML = ICONS[name]
  return s
}

export function brandMark(cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  s.setAttribute('viewBox', '0 0 48 48')
  s.setAttribute('class', cls)
  s.setAttribute('aria-hidden', 'true')
  s.innerHTML =
    '<g fill="none" stroke-width="2.2" stroke-linejoin="round"><path stroke="var(--gold)" d="M24 3l6 8.5 10 2.5-2.5 10L40 34l-10 2.5L24 45l-6-8.5L8 34l2.5-10L8 14l10-2.5z"/><path stroke="currentColor" d="M15 30c3-1.5 6-1.5 9 0 3-1.5 6-1.5 9 0V18c-3-1.5-6-1.5-9 0-3-1.5-6-1.5-9 0zM24 18v12"/></g>'
  return s
}

export function toast(msg, kind = 'ok') {
  const el = h('div', { class: `toast ${kind === 'ok' ? '' : 'bad'}` }, msg)
  document.getElementById('toasts').append(el)
  setTimeout(() => el.remove(), 3500)
}

export function toggleTheme() {
  const dark = document.documentElement.classList.toggle('dark')
  try { localStorage.setItem('halaqa-theme', dark ? 'dark' : 'light') } catch {}
  return dark
}

export const field = (label, control, hint) => {
  const id = control.id || `f${Math.random().toString(36).slice(2, 8)}`
  control.id = id
  return h('div', { class: 'field' }, h('label', { for: id }, label), control, hint && h('p', { class: 'hint' }, hint))
}

export const input = (props = {}) => h('input', { class: 'input', ...props })

export function select(options, { value = '', placeholder, ...props } = {}) {
  const el = h('select', { class: 'input', ...props }, placeholder != null && h('option', { value: '' }, placeholder), options.map(([v, label]) => h('option', { value: String(v) }, label)))
  el.value = String(value)
  return el
}

/** A modal with a form. onSubmit may throw (ApiError or fail()); its message is shown inside the dialog. */
export function formDialog({ title, desc, content = [], submit, danger = false, onSubmit }) {
  const dlg = h('dialog', { class: 'dlg' })
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true })
  const go = h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'submit' }, submit)
  dlg.append(
    h(
      'form',
      {
        class: 'dlg-body',
        onsubmit: async (e) => {
          e.preventDefault()
          go.disabled = true
          err.hidden = true
          try {
            await onSubmit()
            dlg.close()
          } catch (x) {
            err.textContent = errText(x)
            err.hidden = false
          } finally {
            go.disabled = false
          }
        },
      },
      h('h2', {}, title),
      desc && h('p', { class: 'muted' }, desc),
      ...content,
      err,
      h('div', { class: 'dlg-actions' }, go, h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => dlg.close() }, t.cancel)),
    ),
  )
  dlg.addEventListener('close', () => dlg.remove())
  dlg.addEventListener('click', (e) => e.target === dlg && dlg.close())
  document.body.append(dlg)
  dlg.showModal()
  return dlg
}

/** Resolves true when confirmed. */
export function confirmDialog({ title, desc, confirm, danger = false }) {
  return new Promise((resolve) => {
    let done = false
    const dlg = formDialog({ title, desc, submit: confirm, danger, onSubmit: async () => { done = true } })
    dlg.addEventListener('close', () => resolve(done))
  })
}

export function infoDialog({ title, desc, content }) {
  const dlg = h('dialog', { class: 'dlg' }, h('div', { class: 'dlg-body' }, h('h2', {}, title), desc && h('p', { class: 'muted' }, desc), content, h('div', { class: 'dlg-actions' }, h('button', { class: 'btn btn-outline', type: 'button', onclick: () => dlg.close() }, t.back))))
  dlg.addEventListener('close', () => dlg.remove())
  dlg.addEventListener('click', (e) => e.target === dlg && dlg.close())
  document.body.append(dlg)
  dlg.showModal()
  return dlg
}

export const bar = (done, total, gold = false) => {
  const pct = total ? Math.round((done / total) * 100) : 0
  const i = h('i')
  i.style.setProperty('--w', `${pct}%`)
  return h('div', { class: `bar ${gold ? 'gold' : ''}`, role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 }, i)
}
