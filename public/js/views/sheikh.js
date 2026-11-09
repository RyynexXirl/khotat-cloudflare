import { h, icon, field, input, select, bar, toast, formDialog, confirmDialog, infoDialog } from '../ui.js'
import { api } from '../core.js'
import { shell } from '../shell.js'
import { t, errText, fail } from '../lib/msgs.js'
import { AJAWID, SUBGROUPS } from '../lib/names.js'

const debtChip = (n) => (n > 0 ? h('span', { class: 'chip chip-debt' }, t.nDebts(n)) : h('span', { class: 'chip chip-ok' }, t.noDebtsAll.split(' — ')[0]))
const post = (path, body) => api(path, { method: 'POST', body })

export function sheikhView(root) {
  const s = { data: null, edit: false, group: 'all', q: '' }
  const body = h('div', { class: 'stack-lg' }, h('p', { class: 'loading' }, t.loading))
  const addBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => addStudent() }, icon('plus'), t.addStudent)
  const debtBtn = h('button', { class: 'btn btn-outline', type: 'button', onclick: runDebts }, icon('repeat'), t.runDebts)
  root.replaceChildren(shell({ title: t.sheikhTitle, subtitle: t.sheikhSubtitle, actions: [addBtn, debtBtn], body }))

  let listEl, accountsEl
  async function load() {
    try {
      s.data = await api('/api/overview')
      draw()
    } catch (e) {
      body.replaceChildren(h('div', { class: 'empty' }, h('p', {}, errText(e)), h('button', { class: 'btn btn-outline', type: 'button', onclick: load }, t.retry)))
    }
  }

  async function runDebts() {
    debtBtn.disabled = true
    try {
      const r = await post('/api/debts/run')
      toast(t.debtsMarked(r.marked))
      await load()
    } catch (e) {
      toast(errText(e), 'bad')
    } finally {
      debtBtn.disabled = false
    }
  }

  function draw() {
    const d = s.data
    const groupCards = d.groups.map((g) => {
      const members = d.students.filter((x) => x.group_id === g.id)
      const done = members.reduce((a, x) => a + x.done, 0)
      const total = members.reduce((a, x) => a + x.total, 0)
      const pct = total ? Math.round((done / total) * 100) : 0
      return h('button', { class: 'card card-link stack', type: 'button', 'aria-pressed': String(s.group === g.id), onclick: () => { s.group = s.group === g.id ? 'all' : g.id; draw() } },
        h('div', { class: 'row-between' }, h('span', { class: 'group-name' }, g.name), h('span', { class: 'chip' }, t.studentsCount(members.length))),
        h('span', { class: 'muted small' }, t.supervisorOf(g.supervisor)),
        bar(done, total, true),
        h('span', { class: 'muted small' }, t.progressPct(pct)))
    })

    const q = input({ type: 'search', placeholder: t.searchByName, 'aria-label': t.searchByName, value: s.q, class: 'input input-sm' })
    q.addEventListener('input', () => { s.q = q.value; drawList() })
    const sw = h('input', { type: 'checkbox', checked: s.edit, onchange: (e) => { s.edit = e.target.checked; drawList(); drawAccounts() } })
    listEl = h('ul', { class: 'list' })
    accountsEl = h('div', { class: 'grid-2' })

    body.replaceChildren(
      h('div', { class: 'grid-2' },
        h('div', { class: 'card stat' }, h('div', { class: 'k' }, icon('users'), t.totalStudents), h('div', { class: 'v' }, String(d.totals.students)), h('div', { class: 'k' }, t.inGroups(d.groups.length))),
        h('button', { class: 'card card-link stat debt', type: 'button', onclick: showDebtors }, h('div', { class: 'k' }, icon('alert'), t.studentsWithDebts), h('div', { class: 'v' }, String(d.totals.withDebts)), h('div', { class: 'k' }, t.debtDaysShowList(d.totals.totalDebtDays), icon('chevron')))),
      h('div', { class: 'grid-3' }, groupCards),
      h('section', { class: 'stack' },
        h('div', { class: 'row-between' }, h('h2', { class: 'section-title' }, t.students), h('div', { class: 'row' }, q, h('label', { class: 'switch' }, sw, t.editMode))),
        h('div', { class: 'card flush' }, listEl)),
      accountsEl,
    )
    drawList()
    drawAccounts()
  }

  function drawList() {
    const q = s.q.trim()
    const rows = s.data.students.filter((x) => (s.group === 'all' || x.group_id === s.group) && x.name.includes(q))
    listEl.replaceChildren(...(rows.length ? rows.map(row) : [h('li', { class: 'empty' }, t.noMatches)]))
  }

  const row = (st) =>
    h('li', { class: 'srow' },
      h('div', { class: 'srow-main' }, h('a', { class: 'link strong', href: `/plan/${st.id}`, 'data-link': '' }, st.name), h('span', { class: 'muted small' }, `${st.group_name}${st.subgroup ? ` · ${st.subgroup}` : ''}${st.muhaffiz_name ? ` · ${st.muhaffiz_name}` : ''}`)),
      h('div', { class: 'srow-progress' }, bar(st.done, st.total), h('span', { class: 'muted small' }, `${st.done}/${st.total}`)),
      debtChip(st.debts),
      h('div', { class: 'srow-actions' },
        h('a', { class: 'btn btn-outline btn-sm', href: `/plan/${st.id}`, 'data-link': '' }, t.plan),
        s.edit && h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => editStudent(st) }, icon('pencil'), t.edit),
        s.edit && h('button', { class: 'btn btn-danger btn-sm', type: 'button', 'aria-label': t.deleteStudent, onclick: () => removeStudent(st) }, icon('trash'))))

  function drawAccounts() {
    const d = s.data
    const card = (title, addLabel, onAdd, items) =>
      h('section', { class: 'card' },
        h('div', { class: 'row-between' }, h('h2', { class: 'section-title' }, title), h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: onAdd }, icon('plus'), addLabel)),
        items.length ? items.map(({ name, meta, onDelete }) => h('div', { class: 'acct' }, h('div', {}, h('div', { class: 'strong' }, name), h('div', { class: 'muted small' }, meta)), s.edit && h('button', { class: 'btn btn-danger btn-sm', type: 'button', 'aria-label': t.deleteAccount, onclick: onDelete }, icon('trash')))) : h('p', { class: 'muted', style: undefined }, t.noAccounts))
    const gname = (id) => d.groups.find((g) => g.id === id)?.name ?? ''
    accountsEl.replaceChildren(
      card(t.supervisorsSection, t.addSupervisor, addSupervisor, d.supervisors.map((x) => ({ name: x.name, meta: gname(x.group_id), onDelete: () => removeAccount(x, 'supervisors') }))),
      card(t.muhaffizeenSection, t.addMuhaffiz, addMuhaffiz, d.muhaffizeen.map((x) => ({ name: x.name, meta: t.assignedStudents(x.assigned), onDelete: () => removeAccount(x, 'muhaffizeen') }))))
  }

  function showDebtors() {
    const list = s.data.students.filter((x) => x.debts > 0).sort((a, b) => b.debts - a.debts)
    infoDialog({
      title: t.debtorsTitle,
      desc: t.debtorsDesc,
      content: list.length
        ? h('ul', { class: 'list' }, list.map((x) => h('li', { class: 'acct' }, h('div', {}, h('a', { class: 'link strong', href: `/plan/${x.id}`, 'data-link': '' }, x.name), h('div', { class: 'muted small' }, x.group_name)), h('span', { class: 'chip chip-debt' }, t.nDebts(x.debts)))))
        : h('p', { class: 'empty' }, t.noDebtsAll),
    })
  }

  /** Group select plus a sub-group select that only shows for الأجاويد. */
  function groupFields(groupId, subgroup) {
    const g = select(s.data.groups.map((x) => [x.id, x.name]), { value: groupId ?? '', placeholder: groupId ? undefined : t.chooseGroup, required: true })
    const sub = select(SUBGROUPS.map((x) => [x, x]), { value: subgroup ?? '', placeholder: t.chooseSubgroup })
    const subField = field(t.subgroup, sub)
    const sync = () => (subField.hidden = s.data.groups.find((x) => String(x.id) === g.value)?.name !== AJAWID)
    g.addEventListener('change', sync)
    sync()
    return { g, sub, nodes: [field(t.changeGroup, g), subField], isAjawid: () => !subField.hidden }
  }

  function addStudent() {
    const name = input({ required: true, minLength: 2, maxLength: 80 })
    const gf = groupFields()
    const pw = input({ type: 'password', autocomplete: 'new-password', maxLength: 60 })
    formDialog({
      title: t.newStudent, desc: t.newStudentDesc, submit: t.add,
      content: [field(t.studentName, name, t.nameHint), ...gf.nodes, field(t.startPassword, pw, t.startPasswordHint)],
      onSubmit: async () => {
        if (!gf.g.value) throw fail('choose_group')
        if (pw.value && pw.value.length < 4) throw fail('weak_password')
        await post('/api/students', { name: name.value, group_id: Number(gf.g.value), subgroup: gf.isAjawid() ? gf.sub.value || null : null, password: pw.value || undefined })
        toast(t.added)
        await load()
      },
    })
  }

  function editStudent(st) {
    const name = input({ required: true, minLength: 2, maxLength: 80, value: st.name })
    const gf = groupFields(st.group_id, st.subgroup)
    const mh = select([['', t.noMuhaffiz], ...s.data.muhaffizeen.map((m) => [m.id, m.name])], { value: st.muhaffiz_id ?? '' })
    formDialog({
      title: t.editStudent, submit: t.save,
      content: [field(t.rename, name), ...gf.nodes, field(t.assignMuhaffiz, mh)],
      onSubmit: async () => {
        await api(`/api/students/${st.id}`, { method: 'PATCH', body: { name: name.value, group_id: Number(gf.g.value), subgroup: gf.isAjawid() ? gf.sub.value || null : null, muhaffiz_id: mh.value ? Number(mh.value) : null } })
        toast(t.saved)
        await load()
      },
    })
  }

  async function removeStudent(st) {
    if (!(await confirmDialog({ title: t.deleteStudent, desc: t.deleteConfirm(st.name), confirm: t.delete, danger: true }))) return
    try { await api(`/api/students/${st.id}`, { method: 'DELETE' }); toast(t.deleted); await load() } catch (e) { toast(errText(e), 'bad') }
  }

  function addSupervisor() {
    const name = input({ required: true, minLength: 2, maxLength: 80 })
    const g = select(s.data.groups.map((x) => [x.id, x.name]), { placeholder: t.chooseGroup, required: true })
    const pw = input({ type: 'password', autocomplete: 'new-password', required: true, minLength: 4, maxLength: 60 })
    formDialog({
      title: t.addSupervisor, submit: t.add,
      content: [field(t.accountName, name), field(t.group, g), field(t.password, pw)],
      onSubmit: async () => {
        if (!g.value) throw fail('choose_group')
        await post('/api/supervisors', { name: name.value, group_id: Number(g.value), password: pw.value })
        toast(t.accountAdded)
        await load()
      },
    })
  }

  function addMuhaffiz() {
    const name = input({ required: true, minLength: 2, maxLength: 80 })
    const phone = input({ type: 'tel', maxLength: 20 })
    const pw = input({ type: 'password', autocomplete: 'new-password', required: true, minLength: 4, maxLength: 60 })
    formDialog({
      title: t.addMuhaffiz, submit: t.add,
      content: [field(t.accountName, name), field(t.phone, phone), field(t.password, pw)],
      onSubmit: async () => {
        await post('/api/muhaffizeen', { name: name.value, phone: phone.value, password: pw.value })
        toast(t.accountAdded)
        await load()
      },
    })
  }

  async function removeAccount(x, table) {
    if (!(await confirmDialog({ title: t.deleteAccount, desc: t.deleteAccountConfirm(x.name), confirm: t.delete, danger: true }))) return
    try { await api(`/api/${table}/${x.id}`, { method: 'DELETE' }); toast(t.deleted); await load() } catch (e) { toast(errText(e), 'bad') }
  }

  load()
}
