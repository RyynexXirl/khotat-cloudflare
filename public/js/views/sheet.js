// Recitation sheet shared by مشرف (a group) and محفظ (assigned students).
import { h, icon, toast, confirmDialog } from '../ui.js'
import { api, state } from '../core.js'
import { shell } from '../shell.js'
import { t, errText } from '../lib/msgs.js'
import { hijriLabel, semesterDay } from '../lib/semester.js'
import { dayLabel, gradeButtons, gradeLesson, weekdayName } from '../parts.js'

export function sheetView(root) {
  const isSup = state.session.role === 'supervisor'
  const body = h('div', { class: 'stack-lg' }, h('p', { class: 'loading' }, t.loading))
  const frame = (title, subtitle) => root.replaceChildren(shell({ title, subtitle, body }))
  frame(isSup ? t.supervisorTitle('') : t.muhaffizTitle, t.sheetSubtitle(state.session.name))
  let busy = false

  async function load() {
    try {
      const d = await api('/api/sheet')
      if (isSup) frame(t.supervisorTitle(d.groups[0]?.name ?? ''), t.sheetSubtitle(d.who.name))
      draw(d)
    } catch (e) {
      body.replaceChildren(h('div', { class: 'empty' }, h('p', {}, errText(e)), h('button', { class: 'btn btn-outline', type: 'button', onclick: load }, t.retry)))
    }
  }

  async function act(dayId, action) {
    busy = true
    await gradeLesson(dayId, action)
    busy = false
    await load()
  }

  async function gradeAll() {
    if (!(await confirmDialog({ title: t.allDone, desc: t.allDoneConfirm, confirm: t.markDone }))) return
    try {
      const r = await api('/api/sheet/all', { method: 'POST', body: {} })
      toast(t.allDoneResult(r.count))
      await load()
    } catch (e) {
      toast(errText(e), 'bad')
    }
  }

  function draw(d) {
    const today = d.today
    const info = semesterDay(today)
    const caughtUp = d.rows.filter((r) => r.total > 0 && r.behind === 0).length
    const due = d.rows.filter((r) => r.current && r.current.date <= today).length
    const card = ({ student, current, debts, behind, total, lastDone }) => {
      const ahead = !!current && current.date > today
      const late = current && (current.date < today || current.status === 'debt' || current.status === 'missed')
      return h('div', { class: 'card student-card' },
        h('div', { class: 'row-between' },
          h('a', { class: 'link strong', href: `/plan/${student.id}`, 'data-link': '' }, student.name),
          h('div', { class: 'row' },
            debts > 0 && h('span', { class: 'chip chip-debt' }, t.nDebts(debts)),
            total > 0 && (behind > 0 ? h('span', { class: 'chip' }, t.behind(behind)) : h('span', { class: 'chip chip-ok' }, t.caughtUp)))),
        total === 0 ? h('p', { class: 'muted' }, t.emptyPlan)
        : !current ? h('p', { class: 'chip chip-ok' }, t.finished)
        : [
            h('div', { class: `lesson ${late ? 'late' : ''}` },
              h('div', { class: 'row-between' }, dayLabel(current.date, today), h('span', { class: 'muted small' }, ahead ? t.ahead : t.current)),
              h('div', { class: 'stack', style: undefined },
                h('div', { class: 'assign' }, icon('book'), h('span', {}, current.new_memorization || t.noAssignment)),
                h('div', { class: 'assign review' }, icon('repeat'), h('span', {}, current.review || t.noAssignment)))),
            gradeButtons({ disabled: busy, missedDisabled: ahead && current.status !== 'missed', missedActive: current.status === 'missed', onDone: () => act(current.id, 'done'), onMissed: () => act(current.id, 'missed') }),
          ],
        lastDone && h('div', {}, h('button', { class: 'btn btn-ghost btn-sm', type: 'button', disabled: busy, onclick: () => act(lastDone.id, 'undo') }, icon('undo'), `${t.undo} (${weekdayName(lastDone.date)} ${hijriLabel(lastDone.date)})`)))
    }
    body.replaceChildren(
      h('div', { class: 'card row-between' },
        h('div', {}, h('div', { class: 'strong' }, t.todayIs(weekdayName(today), hijriLabel(today)), info?.event && h('span', { class: 'chip chip-warn', style: undefined }, ` ${t.event[info.event]}`)), h('div', { class: 'muted small' }, info ? t.recitedCount(caughtUp, d.rows.length) : t.noStudyToday)),
        h('button', { class: 'btn btn-primary', type: 'button', disabled: due === 0, onclick: gradeAll }, icon('checks'), t.allDone)),
      h('p', { class: 'muted small' }, t.orderRule),
      d.rows.length ? h('div', { class: 'sheet-grid' }, d.rows.map(card)) : h('p', { class: 'empty' }, isSup ? t.noStudents : t.noAssignedStudents),
    )
  }

  load()
}
