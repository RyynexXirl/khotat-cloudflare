// Logged-in page frame: deep header with brand, change password, theme and logout.
import { h, icon, brandMark, field, input, formDialog, toast, toggleTheme } from './ui.js'
import { api, go, state } from './core.js'
import { t, fail } from './lib/msgs.js'

function themeButton() {
  const btn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' })
  const paint = () => {
    const dark = document.documentElement.classList.contains('dark')
    btn.replaceChildren(icon(dark ? 'sun' : 'moon'))
    btn.setAttribute('aria-label', dark ? t.themeLight : t.themeDark)
    btn.title = dark ? t.themeLight : t.themeDark
  }
  btn.addEventListener('click', () => { toggleTheme(); paint() })
  paint()
  return btn
}

function changePassword() {
  const open = () => {
    const cur = input({ type: 'password', autocomplete: 'current-password', required: true })
    const next = input({ type: 'password', autocomplete: 'new-password', required: true, minLength: 4, maxLength: 60 })
    formDialog({
      title: t.changePassword,
      content: [field(t.currentPassword, cur), field(t.newPassword, next)],
      submit: t.save,
      onSubmit: async () => {
        if (next.value.length < 4) throw fail('weak_password')
        await api('/api/password', { method: 'POST', body: { currentPassword: cur.value, newPassword: next.value } })
        toast(t.passwordChanged)
      },
    })
  }
  return h('button', { class: 'btn btn-ghost btn-sm', type: 'button', title: t.changePassword, 'aria-label': t.changePassword, onclick: open }, icon('lock'), h('span', { class: 'sr-only' }, t.changePassword))
}

async function logout() {
  try { await api('/api/logout', { method: 'POST' }) } catch {}
  state.session = null
  go('/')
}

export function shell({ title, subtitle, actions = [], body, docTitle }) {
  const s = state.session
  document.title = `${docTitle ?? title} — ${t.appName}`
  return h(
    'div',
    {},
    h(
      'header',
      { class: 'deep on-deep' },
      h(
        'div',
        { class: 'wrap topbar' },
        h('a', { class: 'brand', href: '/', 'data-link': '' }, brandMark(), h('span', {}, t.appName)),
        h('div', { class: 'top-actions' }, h('span', { class: 'who' }, s.role === 'sheikh' ? t.roles.sheikh : `${t.roles[s.role]} · ${s.name}`), changePassword(), themeButton(), h('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': t.logout, onclick: logout }, icon('logout'), h('span', { class: 'lbl' }, t.logout))),
      ),
      h('div', { class: 'wrap pagehead' }, h('h1', {}, title), subtitle && h('p', { class: 'sub' }, subtitle), actions.length > 0 && h('div', { class: 'actions' }, ...actions)),
    ),
    h('main', { class: 'wrap', id: 'main', tabindex: -1 }, body),
  )
}
