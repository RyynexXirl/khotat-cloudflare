// One student's semester plan: staff write it, grade it, copy it from another student and print it.
import { h, icon, toast, select, formDialog, field } from '../ui.js'
import { api, state, ROLE_HOME } from '../core.js'
import { shell } from '../shell.js'
import { t, errText, fail } from '../lib/msgs.js'
import { lessons } from '../lib/plan.js'
import { gradeLesson, planGrid, planSummary } from '../parts.js'
import { printPlan } from './print.js'

export function planView(root, studentId) {
  const s = { data: null, editing: false, drafts: {}, busy: false }
  const body = h('div', { class: 'stack-lg' }, h('p', { class: 'loading' }, t.loading))
  const backLink = h('a', { class: 'btn btn-outline btn-sm', href: ROLE_HOME[state.session.role], 'data-link': '' }, icon('arrow'), t.backToDashboard)
  const frame = (title, subtitle) => root.replaceChildren(shell({ title, subtitle, actions: [backLink], body, docTitle: title }))
  frame(t.plan)

  async function load() {
    try {
      s.data = await api(`/api/plan/${studentId}`)
      frame(s.data.student.name, t.groupLine(s.data.student.group_name, s.data.supervisor))
      draw()
    } catch (e) {
      body.replaceChildren(h('p', { class: 'empty' }, e.status === 404 || e.status === 403 ? t.studentNotFound : errText(e)))
    }
  }

  const setDays = (days) => { s.data.days = days; draw() }

  async function grade(dayId, action) {
    s.busy = true
    draw()
    const res = await gradeLesson(dayId, action)
    s.busy = false
    if (res?.days?.length) s.data.days = res.days
    draw()
  }

  async function save(btn) {
    btn.disabled = true
    try {
      const items = Object.entries(s.drafts).map(([id, v]) => ({ id: Number(id), ...v }))
      setDays(await api(`/api/plan/${studentId}`, { method: 'PUT', body: { items } }))
      s.drafts = {}
      s.editing = false
      draw()
      toast(t.planSaved)
    } catch (e) {
      toast(errText(e), 'bad')
      btn.disabled = false
    }
  }

  function copyDialog() {
    const sel = select(s.data.classmates.map((c) => [c.id, c.name]), { placeholder: t.chooseStudent, required: true })
    formDialog({
      title: t.copyFrom, desc: t.copyFromHint, submit: t.copy,
      content: [field(t.chooseStudent, sel)],
      onSubmit: async () => {
        if (!sel.value) throw fail('choose_student')
        setDays(await api(`/api/plan/${studentId}/copy`, { method: 'POST', body: { from_student_id: Number(sel.value) } }))
        toast(t.copied)
      },
    })
  }

  // The grid is rebuilt on grade/save/toggle, never on typing, so inputs keep focus.
  let gridHost, saveBtn
  function draw() {
    const d = s.data
    const empty = lessons(d.days).length === 0
    const dirty = () => Object.keys(s.drafts).length > 0
    saveBtn = h('button', { class: 'btn btn-primary btn-sm', type: 'button', disabled: true, onclick: (e) => save(e.currentTarget) }, icon('save'), t.savePlan)
    const actions = s.editing
      ? [saveBtn, h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { s.drafts = {}; s.editing = false; draw() } }, icon('x'), t.cancel)]
      : [
          h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => { s.editing = true; draw() } }, icon('pencil'), t.editPlan),
          h('button', { class: 'btn btn-outline btn-sm', type: 'button', disabled: d.classmates.length === 0, onclick: copyDialog }, icon('copy'), t.copyFrom),
          h('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: () => printPlan(d.student.name, d.days) }, icon('download'), t.exportPdf),
        ]
    gridHost = planGrid({
      days: d.days, today: d.today, canGrade: true, editing: s.editing, drafts: s.drafts, busy: s.busy, onGrade: grade,
      onDraft: (id, patch) => {
        const day = d.days.find((x) => x.id === id)
        s.drafts[id] = { new_memorization: day.new_memorization, review: day.review, ...s.drafts[id], ...patch }
        saveBtn.disabled = !dirty()
      },
    })
    body.replaceChildren(
      planSummary(d.days),
      h('div', { class: 'toolbar row-between' }, h('div', {}, h('h2', { class: 'section-title' }, t.semesterPlan), h('p', { class: 'muted small', dir: 'rtl' }, t.semesterRange)), h('div', { class: 'row' }, ...actions)),
      !s.editing && h('p', { class: 'muted small' }, empty ? t.emptyPlan : t.orderRule),
      gridHost,
    )
  }

  load()
}
