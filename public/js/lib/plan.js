// Framework-free plan rules, shared by the Worker (authoritative) and the browser (display).
// Progression: lessons are recited strictly in order; a lesson not done by its date is a debt.

export const TIME_ZONE = 'Asia/Riyadh'
export const DEBT_CUTOFF_HOUR = 16 // 4 PM Riyadh
export const DAY_STATUSES = ['pending', 'done', 'missed', 'debt']
export const DEBT_STATUSES = ['debt', 'missed']

export const hasContent = (d) => d.new_memorization.trim() !== '' || d.review.trim() !== ''

/** Lessons in order, ignoring days with no assignment. */
export const lessons = (days) => days.filter(hasContent).sort((a, b) => a.day_number - b.day_number)

export const currentLesson = (days) => lessons(days).find((d) => d.status !== 'done')

/** The only lesson that can be un-done without breaking the order. */
export function lastDoneLesson(days) {
  const l = lessons(days)
  const cur = l.findIndex((d) => d.status !== 'done')
  const idx = cur === -1 ? l.length - 1 : cur - 1
  return idx >= 0 ? l[idx] : undefined
}

export const isDebt = (d) => DEBT_STATUSES.includes(d.status)
export const debtCount = (days) => lessons(days).filter(isDebt).length

export const todayIso = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(now)

export const currentHour = (now = new Date()) =>
  Number(new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, hour: 'numeric', hourCycle: 'h23' }).format(now))

/** Status a not-done lesson should have right now. */
export function openStatus(date, now = new Date()) {
  const today = todayIso(now)
  return date < today || (date === today && currentHour(now) >= DEBT_CUTOFF_HOUR) ? 'debt' : 'pending'
}

export const weekday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay()

/** Per-student figures derived from plan rows. */
export function progressOf(days, today) {
  const l = lessons(days)
  const done = l.filter((d) => d.status === 'done').length
  const dueByToday = l.filter((d) => d.date <= today).length
  return { total: l.length, done, debts: debtCount(days), behind: Math.max(0, dueByToday - done), current: currentLesson(days) ?? null }
}
