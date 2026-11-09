import { h, icon, brandMark, field, input, select, toast } from '../ui.js'
import { api, go, state, ROLE_HOME } from '../core.js'
import { t, errText, fail } from '../lib/msgs.js'
import { AJAWID, SUBGROUPS } from '../lib/names.js'

const ROLES = ['sheikh', 'supervisor', 'muhaffiz', 'student']

function hero() {
  const star = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  star.setAttribute('viewBox', '0 0 100 100')
  star.setAttribute('class', 'star')
  star.setAttribute('aria-hidden', 'true')
  star.innerHTML = '<g fill="none" stroke="currentColor" stroke-width="0.8"><rect x="18" y="18" width="64" height="64"/><rect x="18" y="18" width="64" height="64" transform="rotate(45 50 50)"/><circle cx="50" cy="50" r="14"/><circle cx="50" cy="50" r="32"/></g>'
  return h(
    'section',
    { class: 'login-hero deep on-deep', 'data-enter': '' },
    brandMark('mark'),
    h('p', { class: 'eyebrow' }, t.appTagline),
    h('h1', {}, t.appName),
    h('p', { class: 'lede' }, t.lede),
    h('dl', { class: 'facts' }, t.facts.map(([n, label]) => h('div', {}, h('dt', {}, n), h('dd', {}, label)))),
    star,
  )
}

export async function loginView(root) {
  document.title = `${t.appName} — ${t.appTagline}`
  const card = h('section', { class: 'login-card' })
  root.replaceChildren(h('div', { class: 'login', id: 'main' }, hero(), card))

  let dir
  const s = { mode: 'login', role: null, groupId: null, studentId: null }
  const groupName = (id) => dir.groups.find((g) => g.id === id)?.name ?? ''
  const panel = (...kids) => h('div', { class: 'login-panel' }, ...kids)
  const back = (fn) => h('button', { class: 'link-btn', type: 'button', onclick: fn, style: undefined }, `→ ${t.back}`)

  async function load() {
    card.replaceChildren(panel(h('p', { class: 'muted' }, t.loading)))
    try {
      dir = await api('/api/directory')
      draw()
    } catch (e) {
      card.replaceChildren(panel(h('p', { class: 'form-error' }, errText(e)), h('button', { class: 'btn btn-outline', type: 'button', onclick: load }, t.retry)))
    }
  }

  function draw() {
    const kids = s.mode === 'register' ? registerPanel() : s.role ? formPanel() : rolePanel()
    card.replaceChildren(panel(...kids))
    card.querySelector('input:not([type=hidden]), select')?.focus({ preventScroll: true })
  }

  function rolePanel() {
    return [
      h('h2', {}, t.loginAs),
      h('div', { class: 'tiles' }, ROLES.map((r) => h('button', { class: 'card card-link tile', type: 'button', onclick: () => { s.role = r; draw() } }, h('span', {}, h('span', { class: 'tile-title' }, t.roles[r]), h('span', { class: 'tile-desc' }, t.roleDesc[r])), icon('chevron')))),
      h('button', { class: 'link-btn', type: 'button', onclick: () => { s.mode = 'register'; draw() } }, t.noAccount),
    ]
  }

  function studentPicker() {
    const box = h('div', { class: 'stack' })
    const paint = () => {
      if (s.studentId) {
        const st = dir.students.find((x) => x.id === s.studentId)
        box.replaceChildren(h('div', { class: 'selected' }, h('span', {}, t.selected(st?.name ?? '')), h('button', { class: 'link-btn', type: 'button', onclick: () => { s.studentId = null; paint() } }, t.change)))
        return
      }
      const results = h('div', { class: 'results', hidden: true })
      const search = input({ type: 'search', placeholder: t.searchName, autocomplete: 'off', 'aria-label': t.studentName })
      const fill = () => {
        const q = search.value.trim()
        const hits = dir.students.filter((x) => x.group_id === s.groupId && x.name.includes(q)).slice(0, 40)
        results.hidden = false
        results.replaceChildren(...(hits.length ? hits.map((x) => h('button', { type: 'button', onclick: () => { s.studentId = x.id; paint() } }, x.name)) : [h('p', { class: 'none' }, t.noResults)]))
      }
      search.addEventListener('input', fill)
      box.replaceChildren(
        h('div', { class: 'field' }, h('span', { class: 'label' }, t.group), h('div', { class: 'pick' }, dir.groups.map((g) => h('button', { type: 'button', 'aria-pressed': String(s.groupId === g.id), onclick: () => { s.groupId = g.id; paint(); box.querySelector('input')?.focus() } }, g.name)))),
        s.groupId && field(t.studentName, search),
        s.groupId && results,
      )
      if (s.groupId) fill()
    }
    paint()
    return box
  }

  function formPanel() {
    const role = s.role
    const pw = input({ type: 'password', autocomplete: 'current-password', required: true })
    let picker = null
    let pickedId = () => 0
    if (role === 'supervisor' || role === 'muhaffiz') {
      const sup = role === 'supervisor'
      const sel = select((sup ? dir.supervisors : dir.muhaffizeen).map((x) => [x.id, sup ? `${x.name} — ${groupName(x.group_id)}` : x.name]), { placeholder: t.chooseFromList })
      picker = field(sup ? t.chooseSupervisor : t.chooseMuhaffiz, sel)
      pickedId = () => Number(sel.value) || 0
    } else if (role === 'student') {
      picker = studentPicker()
      pickedId = () => s.studentId ?? 0
    }
    const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, t.login)
    const form = h(
      'form',
      {
        class: 'stack',
        onsubmit: async (e) => {
          e.preventDefault()
          const id = pickedId()
          if (role !== 'sheikh' && !id) return toast(t.errors[`choose_${role}`], 'bad')
          submit.disabled = true
          submit.textContent = t.loggingIn
          try {
            const res = await api('/api/login', { method: 'POST', body: { role, id: id || undefined, password: pw.value } })
            state.session = res.session
            toast(t.welcome(res.session.name))
            go(ROLE_HOME[role])
          } catch (x) {
            toast(errText(x), 'bad')
            submit.disabled = false
            submit.textContent = t.login
          }
        },
      },
      picker,
      field(t.yourPassword, pw),
      submit,
    )
    return [back(() => { s.role = null; s.studentId = null; draw() }), h('h2', {}, t.loginTitle(t.roles[role])), form]
  }

  function registerPanel() {
    const name = input({ required: true, minLength: 2, maxLength: 80, autocomplete: 'name' })
    const group = select(dir.groups.map((g) => [g.id, g.name]), { placeholder: t.chooseGroup, required: true })
    const sub = select(SUBGROUPS.map((x) => [x, x]), { placeholder: t.chooseSubgroup })
    const subField = field(t.subgroup, sub)
    subField.hidden = true
    group.addEventListener('change', () => { subField.hidden = groupName(Number(group.value)) !== AJAWID })
    const phone = input({ type: 'tel', maxLength: 20, autocomplete: 'tel', inputMode: 'tel' })
    const pw = input({ type: 'password', autocomplete: 'new-password', required: true, minLength: 4, maxLength: 60 })
    const pw2 = input({ type: 'password', autocomplete: 'new-password', required: true })
    const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, t.registerSubmit)
    const form = h(
      'form',
      {
        class: 'stack',
        onsubmit: async (e) => {
          e.preventDefault()
          try {
            if (pw.value.length < 4) throw fail('weak_password')
            if (pw.value !== pw2.value) throw fail('password_mismatch')
            submit.disabled = true
            submit.textContent = t.registering
            const gid = Number(group.value)
            const res = await api('/api/register', { method: 'POST', body: { name: name.value, group_id: gid, subgroup: groupName(gid) === AJAWID ? sub.value || undefined : undefined, phone: phone.value, password: pw.value } })
            dir = await api('/api/directory')
            Object.assign(s, { mode: 'login', role: 'student', groupId: res.group_id, studentId: res.id })
            toast(t.registerSuccess)
            draw()
          } catch (x) {
            toast(errText(x), 'bad')
            submit.disabled = false
            submit.textContent = t.registerSubmit
          }
        },
      },
      field(t.fullName, name, t.nameHint),
      field(t.group, group),
      subField,
      field(t.phone, phone),
      field(t.password, pw),
      field(t.confirmPassword, pw2),
      submit,
    )
    return [back(() => { s.mode = 'login'; draw() }), h('h2', {}, t.registerTitle), form]
  }

  load()
}
