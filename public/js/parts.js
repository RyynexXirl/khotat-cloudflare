// Pieces shared by the plan page, the student page and the grading sheets.
import { h, icon, toast } from './ui.js'
import { api } from './core.js'
import { t, errText } from './lib/msgs.js'
import { currentLesson, debtCount, lastDoneLesson, lessons, weekday } from './lib/plan.js'
import { SEMESTER, hijriLabel } from './lib/semester.js'
import { bar } from './ui.js'

export const weekdayName = (iso) => t.weekdays[weekday(iso)]
export const formatGregorian = (iso) => new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`))

const STATUS = { pending: ['chip', 'dashed'], done: ['chip chip-ok', 'check'], missed: ['chip chip-bad', 'x'], debt: ['chip chip-debt', 'alert'] }
export function statusChip(status) {
  const [cls, ic] = STATUS[status] ?? STATUS.pending
  return h('span', { class: cls }, icon(ic), t.status[STATUS[status] ? status : 'pending'])
}

export function dayLabel(date, today) {
  return h(
    'div',
    { class: 'day-label' },
    h('b', {}, weekdayName(date), h('span', { dir: 'ltr' }, `(${hijriLabel(date)})`), date === today && h('span', { class: 'chip chip-gold' }, t.today)),
    h('small', {}, formatGregorian(date)),
  )
}

export function planSummary(days) {
  const l = lessons(days)
  const done = l.filter((d) => d.status === 'done').length
  const debts = debtCount(days)
  const mini = (k, v, hint, danger) => h('div', { class: `card mini ${danger ? 'danger' : ''}` }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, String(v)), h('div', { class: 'k' }, hint))
  return h('div', { class: 'summary' }, mini(t.lessonsDone, done, t.of(l.length)), mini(t.debts, debts, t.debtsHint, debts > 0), mini(t.remaining, l.length - done, t.remainingHint), bar(done, l.length))
}

/** The two grading buttons. An active grade shows pressed; clicking it again returns the day to «لم يُسمِّع». */
export function gradeButtons({ onDone, onMissed, disabled = false, missedDisabled = false, doneActive = false, missedActive = false, small = false }) {
  return h(
    'div',
    { class: `grade ${small ? 'sm' : ''}` },
    h('button', { class: 'btn btn-done', type: 'button', disabled, 'aria-pressed': String(doneActive), onclick: onDone }, icon('check'), t.markDone),
    h('button', { class: 'btn btn-miss', type: 'button', disabled: disabled || missedDisabled, 'aria-pressed': String(missedActive), onclick: onMissed }, icon('x'), t.markMissed),
  )
}

/** Records تم الحفظ / لم يحفظ / تراجع for one lesson. Returns the API result, or null when the call failed. */
export async function gradeLesson(dayId, action) {
  try {
    const res = await api('/api/grade', { method: 'POST', body: { day_id: dayId, action } })
    if (!res.ok) toast(t.errors[res.error] ?? t.saveFailed, 'bad')
    else {
      const off = (action === 'done' || action === 'missed') && res.status === 'pending'
      toast(off || action === 'undo' ? t.undone : action === 'done' ? t.savedDone : t.savedMissed)
    }
    return res
  } catch (e) {
    toast(errText(e), 'bad')
    return null
  }
}

const EVENT_CHIP = { debt_repayment: 'chip chip-warn', exam: 'chip chip-info', national_day: 'chip chip-info' }

export function planGrid({ days, today, canGrade = false, editing = false, drafts = {}, onDraft, onGrade, busy = false }) {
  const byDate = new Map(days.map((d) => [d.date, d]))
  const current = currentLesson(days)
  const lastDone = lastDoneLesson(days)

  const dayRow = (sd) => {
    const day = byDate.get(sd.date)
    if (sd.event || !day) {
      return h('div', { class: `day day-event ${sd.date === today ? 'today' : ''}` }, dayLabel(sd.date, today), sd.event && h('span', { class: EVENT_CHIP[sd.event] }, t.event[sd.event]))
    }
    const isCurrent = current?.id === day.id
    const empty = !day.new_memorization.trim() && !day.review.trim()
    const draft = drafts[day.id]
    const cls = `day ${sd.date === today ? 'today' : ''} ${isCurrent && !editing ? 'current' : ''}`
    if (editing) {
      const box = (label, key) => h('input', { class: 'input', 'aria-label': label, placeholder: label, maxLength: 300, value: draft?.[key] ?? day[key], oninput: (e) => onDraft(day.id, { [key]: e.target.value }) })
      return h('div', { class: cls }, dayLabel(sd.date, today), box(t.newMemorization, 'new_memorization'), box(t.review, 'review'), h('span'))
    }
    return h(
      'div',
      { class: cls },
      dayLabel(sd.date, today),
      h('div', { class: 'assign' }, icon('book'), h('span', { class: day.new_memorization ? '' : 'muted' }, day.new_memorization || t.noAssignment)),
      h('div', { class: 'assign review' }, icon('repeat'), h('span', {}, day.review || t.noAssignment)),
      h(
        'div',
        { class: 'day-side' },
        !empty && statusChip(day.status),
        day.status === 'done' && day.date > today && h('span', { class: 'chip chip-ok' }, t.ahead),
        canGrade && isCurrent && gradeButtons({ small: true, disabled: busy, missedDisabled: day.date > today && day.status !== 'missed', missedActive: day.status === 'missed', onDone: () => onGrade(day.id, 'done'), onMissed: () => onGrade(day.id, 'missed') }),
        canGrade && lastDone?.id === day.id && !isCurrent && gradeButtons({ small: true, disabled: busy, missedDisabled: true, doneActive: true, onDone: () => onGrade(day.id, 'done'), onMissed: () => {} }),
      ),
    )
  }

  return h(
    'div',
    { class: 'weeks' },
    SEMESTER.map((w) => h('section', { class: 'week' }, h('div', { class: 'week-head' }, t.week(w.number), w.vacation && h('span', { class: 'muted small' }, t.vacation)), w.vacation ? h('div', { class: 'day muted' }, t.vacation) : w.days.map(dayRow))),
  )
}
