export const AJAWID = 'الأجاويد'
export const SUBGROUPS = ['الصناديد', 'الرعود', 'الكواسر']

/** «محمد عبدالله السبيعي» → «محمد بن عبدالله السبيعي» (three words or more, no بن/ابن/بنت yet). */
export function formatStudentName(raw) {
  const parts = raw.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 3 && !parts.includes('بن') && !parts.includes('ابن') && !parts.includes('بنت')) {
    return [parts[0], 'بن', ...parts.slice(1)].join(' ')
  }
  return parts.join(' ')
}

/** «سورة الحشر (21–24) + سورة الممتحنة (1–4)» → surah / from / to columns for the printed plan. */
export function parseAssignment(text) {
  const m = [...text.matchAll(/سورة\s+([^()+]+?)\s*\((\d+)\s*[–—-]\s*(\d+)\s*\)/g)]
  if (!m.length) return { from: '', to: '', surah: text.trim() }
  return { from: m[0][2], to: m[m.length - 1][3], surah: [...new Set(m.map((x) => x[1].trim()))].join(' + ') }
}
