import { h, icon } from '../ui.js'
import { api, state } from '../core.js'
import { shell } from '../shell.js'
import { t, errText } from '../lib/msgs.js'
import { currentLesson, isDebt, lessons } from '../lib/plan.js'
import { hijriLabel } from '../lib/semester.js'
import { dayLabel, planGrid, planSummary, weekdayName } from '../parts.js'

export function studentView(root) {
  const body = h('div', { class: 'stack-lg' }, h('p', { class: 'loading' }, t.loading))
  const frame = (subtitle) => root.replaceChildren(shell({ title: t.hello(state.session.name), subtitle, docTitle: t.myPlan, body }))
  frame(t.myPlan)

  api(`/api/plan/${state.session.id}`).then(
    (d) => {
      frame(t.groupLine(d.student.group_name, d.supervisor))
      const debtDays = lessons(d.days).filter(isDebt)
      const next = currentLesson(d.days)
      body.replaceChildren(
        next && h('div', { class: 'card next' }, h('div', { class: 'row-between' }, h('span', { class: 'strong' }, t.nextLesson), dayLabel(next.date, d.today)), h('div', { class: 'big' }, next.new_memorization || t.noAssignment), h('div', { class: 'muted' }, `${t.review}: ${next.review || t.noAssignment}`)),
        planSummary(d.days),
        debtDays.length > 0 && h('div', { class: 'card debt-box' }, h('div', { class: 'strong row' }, icon('alert'), t.youHaveDebts(debtDays.length)), h('ol', {}, debtDays.map((x) => h('li', {}, `${weekdayName(x.date)} (${hijriLabel(x.date)}): ${x.new_memorization}`)))),
        h('section', { class: 'stack' }, h('h2', { class: 'section-title' }, t.semesterPlan), planGrid({ days: d.days, today: d.today })),
      )
    },
    (e) => body.replaceChildren(h('p', { class: 'empty' }, e.status === 404 ? t.accountNotFound : errText(e))),
  )
}
