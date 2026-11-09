// Landscape replica of the official plan sheet; the browser's "Save as PDF" makes the file.
import { h } from '../ui.js'
import { t } from '../lib/msgs.js'
import { parseAssignment } from '../lib/names.js'
import { SEMESTER, SEMESTER_DAYS, hijriLabel } from '../lib/semester.js'
import { weekdayName } from '../parts.js'

const startText = (text) => {
  const p = parseAssignment(text)
  return !p.surah ? '' : p.from ? `${p.surah} من ${p.from}` : p.surah
}

function weekTable(weeks, byDate) {
  const cols = [8.5, 9.5, 7.5, 19, 5.5, 5.5, 7, 19.5, 5.5, 5.5, 7]
  const colgroup = h('colgroup', {}, cols.map((w) => { const c = h('col'); c.style.width = `${w}%`; return c }))
  const th = (text, attrs) => h('th', attrs, text)
  const head = h('thead', {},
    h('tr', {}, th(t.weekCol, { rowSpan: 2 }), th(t.day, { rowSpan: 2 }), th(t.date, { rowSpan: 2 }), th(t.printNewMem, { colSpan: 3 }), th(t.printGrade, { rowSpan: 2 }), th(t.printReview, { colSpan: 3 }), th(t.printGrade, { rowSpan: 2 })),
    h('tr', {}, [t.printSurah, t.printFrom, t.printTo, t.printSurah, t.printFrom, t.printTo].map((x) => th(x))))
  const rows = weeks.flatMap((w) => {
    if (w.vacation) return [h('tr', {}, h('td', { class: 'week-cell' }, t.weekOrdinal(w.number)), h('td', { class: 'event-cell', colSpan: 10 }, t.vacation))]
    return w.days.map((sd, i) => {
      const day = byDate.get(sd.date)
      const nm = parseAssignment(day?.new_memorization ?? '')
      const rv = parseAssignment(day?.review ?? '')
      const status = day?.status in t.status ? day.status : 'pending'
      const grade = sd.event || status === 'pending' ? '' : t.status[status]
      return h('tr', {},
        i === 0 && h('td', { class: 'week-cell', rowSpan: w.days.length }, t.weekOrdinal(w.number)),
        h('td', { class: 'day-cell' }, weekdayName(sd.date)),
        h('td', { class: 'date-cell' }, hijriLabel(sd.date)),
        sd.event ? h('td', { class: 'event-cell', colSpan: 8 }, t.event[sd.event])
          : [h('td', {}, nm.surah), h('td', {}, nm.from), h('td', {}, nm.to), h('td', { class: 'grade-cell' }, grade), h('td', {}, rv.surah), h('td', {}, rv.from), h('td', {}, rv.to), h('td', { class: 'grade-cell' }, grade)])
    })
  })
  return h('table', {}, colgroup, head, h('tbody', {}, rows))
}

export function printPlan(studentName, days) {
  const byDate = new Map(days.map((d) => [d.date, d]))
  const first = SEMESTER_DAYS.map((sd) => byDate.get(sd.date)).find((d) => d?.new_memorization.trim())
  const start = first ? startText(first.new_memorization) : ''
  const root = h('div', { class: 'print-root' },
    h('div', { class: 'print-title' }, t.printSemesterLine),
    h('div', { class: 'print-student' }, h('span', {}, `${t.studentName} / `, h('strong', {}, studentName)), h('span', {}, `${t.memStart} / `, h('strong', {}, start || '………………'))),
    h('div', { class: 'print-weeks' }, weekTable(SEMESTER.filter((w) => w.number <= 9), byDate), weekTable(SEMESTER.filter((w) => w.number >= 10), byDate)))
  const mount = document.getElementById('print')
  mount.replaceChildren(root)
  const done = () => { mount.replaceChildren(); window.removeEventListener('afterprint', done) }
  window.addEventListener('afterprint', done)
  setTimeout(() => window.print(), 50)
}
