// Sort a deadline into a category, to decide what may be added from email
// automatically. Important college items (exams, submissions, official forms,
// college events) can be added straight away; everything else — scholarships,
// internships, outside competitions, webinars, promotions — stays a suggestion.

export type DeadlineCategory = 'exam' | 'submission' | 'form' | 'event' | 'other'

export const CATEGORY_LABEL: Record<DeadlineCategory, string> = {
  exam: 'Exams & tests',
  submission: 'Assignments & submissions',
  form: 'Official college forms',
  event: 'College events & festivals',
  other: 'Other (scholarships, internships, competitions…)',
}

export const AUTO_ADD_DEFAULT: DeadlineCategory[] = ['exam', 'submission', 'form', 'event']

/** Things that are NOT the college's own academic business. Checked first. */
const OTHER = /\b(scholarships?|internships?|jobs?|hiring|recruit\w*|placements?|placement drive|webinars?|hackathons?|competitions?|contests?|quiz competition|olympiad|offers?|discounts?|newsletters?|surveys?|giveaways?|sponsor\w*|fellowships?|stipend|external|startup|ambassador|campus ambassador)\b/i
const EXAM = /\b(exams?|examinations?|tests?|quiz(?:zes)?|viva|orals?|mid[- ]?sems?|end[- ]?sems?|in[- ]?sems?|ise|ese|cie|unit test|practical exam|re[- ]?exam|backlog|supplementary|hall ticket|admit card|seating arrangement|timetable for exam)\b/i
const SUBMISSION = /\b(assignments?|submissions?|submit|lab (?:file|manual|record|journal)s?|journals?|record books?|projects?|reports?|presentations?|seminars?|tutorials?|homework|case stud(?:y|ies)|mini[- ]?project|write[- ]?ups?|certificates? (?:submission|upload))\b/i
const FORM = /\b(exam(?:ination)? forms?|forms?|registrations?|register|re[- ]?registration|enrol(?:l)?(?:ment)?|fees?|fee payment|payment|elective selection|course registration|no[- ]?dues|id card|bonafide|attendance (?:form|declaration)|undertaking)\b/i
const EXAM_FORM = /\b(exam(?:ination)?|backlog|re[- ]?exam|supplementary)\s+(forms?|fees?|registrations?|payments?)\b/i
const EVENT = /\b(fest|festivals?|annual day|sports day|cultural|convocation|orientation|induction|celebration|college event|guest lecture|industrial visit|expert talk|freshers|farewell|function|ceremony|parent[- ]teacher meeting|ptm)\b/i

export function categorize(...texts: (string | undefined)[]): DeadlineCategory {
  const t = texts.filter(Boolean).join(' \n ')
  if (OTHER.test(t)) return 'other'
  // "exam form", "exam fee" are forms, not the exam itself
  if (EXAM_FORM.test(t)) return 'form'
  if (EXAM.test(t)) return 'exam'
  if (SUBMISSION.test(t)) return 'submission'
  if (FORM.test(t)) return 'form'
  if (EVENT.test(t)) return 'event'
  return 'other'
}

/** Regex source (Java-compatible) for the background email check: subjects
 *  worth a notification for the chosen categories. */
export function importantSubjectPattern(cats: DeadlineCategory[]): string {
  const parts: string[] = []
  if (cats.includes('exam')) parts.push('exam', 'test', 'quiz', 'viva', 'mid[- ]?sem', 'end[- ]?sem', 'hall ticket', 'admit card')
  if (cats.includes('submission')) parts.push('assignment', 'submission', 'submit', 'lab file', 'journal', 'project', 'report', 'presentation', 'seminar')
  if (cats.includes('form')) parts.push('form', 'registration', 'register', 'enrol', 'fee', 'payment')
  if (cats.includes('event')) parts.push('fest', 'festival', 'annual day', 'sports day', 'cultural', 'convocation', 'orientation', 'holiday', 'vacation', 'closed')
  if (cats.includes('other')) parts.push('deadline', 'last date', 'due')
  return parts.length ? `(?i)\\b(${parts.join('|')})` : ''
}

const PUBLIC_MAIL = /^(gmail|googlemail|yahoo|outlook|hotmail|live|icloud|proton|protonmail|rediffmail|aol)\./i

/** The college's mail domain from the connected account ("me@vupune.ac.in" →
 *  "vupune.ac.in"); null for personal providers like gmail.com. */
export function collegeDomainOf(email: string | null | undefined): string | null {
  const d = (email ?? '').split('@')[1]?.toLowerCase()
  if (!d || PUBLIC_MAIL.test(d)) return null
  return d
}

/** Is the sender ("Name <x@dept.vupune.ac.in>") from that college domain? */
export function fromCollege(from: string, domain: string | null): boolean {
  if (!domain) return true // can't tell — don't block
  const m = /@([a-z0-9.-]+)/i.exec(from)
  const d = m?.[1]?.toLowerCase() ?? ''
  return d === domain || d.endsWith(`.${domain}`)
}
