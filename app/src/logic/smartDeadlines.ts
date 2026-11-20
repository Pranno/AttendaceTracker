// Deadline reading with a choice of reader (Settings → Smart import):
//  • Standard — the offline rule-based reader in deadlines.ts
//  • Smart    — Gemini reads the message like a person would
// Smart falls back to Standard (and says so) when it can't run: no key, no
// internet, free limit reached… so pasting a message never just fails.
// Emails are sent to Gemini in ONE batch request, so checking 25 emails
// costs one request of the free tier, not 25.

import type { AppSettings, DateStr } from '../data/model'
import { extractDeadlines, type ExtractedDeadline, type SubjectRef } from './deadlines'
import { hasGeminiKey, readTextAsJson } from './gemini'
import { extractHolidays, type ExtractedHoliday } from './holidays'

export type DeadlineReader = 'standard' | 'smart'

export function deadlineReaderOf(settings: Pick<AppSettings, 'deadlineReader'>): DeadlineReader {
  return settings.deadlineReader === 'smart' && hasGeminiKey() ? 'smart' : 'standard'
}

const ITEM_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short task title, e.g. "WAD lab file submission"' },
    dueDate: { type: 'string', description: 'Due date as YYYY-MM-DD' },
    yearPrinted: { type: 'boolean', description: 'true if the message states the year of the due date' },
    subject: { type: 'string', description: 'Short name of the matching subject from the list, or empty' },
    sourceLine: { type: 'string', description: 'The sentence of the message that states this deadline' },
    urls: { type: 'array', items: { type: 'string' }, description: 'Links in the message that belong to this task' },
  },
  required: ['title', 'dueDate', 'sourceLine'],
}

const HOLIDAY_SCHEMA = {
  type: 'object',
  properties: {
    label: { type: 'string', description: 'Short name, e.g. "Diwali vacation" or "Guru Nanak Jayanti"; "Holiday" if no reason is given' },
    startDate: { type: 'string', description: 'First day off, YYYY-MM-DD' },
    endDate: { type: 'string', description: 'Last day off, YYYY-MM-DD (same as startDate for one day)' },
    yearPrinted: { type: 'boolean' },
    sourceLine: { type: 'string' },
  },
  required: ['label', 'startDate', 'endDate', 'sourceLine'],
}

const HOLIDAY_RULES = `
Also list HOLIDAYS separately: days when the college is closed or there are no lectures for everyone (holiday, vacation, break, "college will remain closed", "no lectures", classes suspended). Give the first and last day off. A holiday is NOT a deadline — never put it in the deadlines list. Exam days are not holidays.`

interface RawHoliday { label?: string; startDate?: string; endDate?: string; yearPrinted?: boolean; sourceLine?: string }

/** Validate Gemini's holidays into the Standard reader's shape. */
export function toHolidays(items: RawHoliday[] | undefined, today: DateStr): ExtractedHoliday[] {
  const out: ExtractedHoliday[] = []
  const real = (v: string | undefined) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((v ?? '').trim())
    if (!m) return null
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    return d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? (`${m[1]}-${m[2]}-${m[3]}` as DateStr) : null
  }
  for (const h of items ?? []) {
    const start = real(h.startDate)
    const end = real(h.endDate) ?? start
    if (!start || !end || end < start) continue
    if (out.some((x) => x.startDate === start && x.endDate === end)) continue
    out.push({
      label: (h.label ?? '').trim() || 'Holiday',
      startDate: start,
      endDate: end,
      tentative: h.yearPrinted === false && start.slice(0, 4) > today.slice(0, 4),
      sourceLine: (h.sourceLine ?? '').trim().slice(0, 300),
    })
  }
  return out
}

function instructions(today: DateStr, subjects: SubjectRef[]): string {
  const list = subjects.length
    ? subjects.map((s) => `${s.shortName}${s.fullName && s.fullName !== s.shortName ? ` (${s.fullName})` : ''}${s.nicknames?.length ? ` — also called ${s.nicknames.join(', ')}` : ''}`).join('; ')
    : '(none)'
  return `You read messages a college student received (class WhatsApp groups, notices, emails) and pull out deadlines.
Today is ${today}. The student's subjects: ${list}.
Extract EVERY dated item the student has to act on, of every kind, for example:
- exams and tests: mid-sem, end-sem, unit test, quiz, viva, oral, practical exam, hall ticket / admit card download
- submissions: assignments, lab files / journals, reports, projects, presentations, seminars, certificates, documents
- registrations and forms: event / hackathon / workshop / course (NPTEL etc.) registration or enrolment, any form to fill, applications (internships, scholarships)
- payments: exam fees, college fees, fines
- other dated must-dos: meetings, orientations, mandatory events
Rules:
- One item per distinct deadline. Skip anything with no date, and plain announcements with nothing to do.
- dueDate as YYYY-MM-DD. Dates in these messages are day-first (05/11 = 5 November). Resolve "tomorrow", "next Monday", "this Friday" from today. If the year is not written, use the next such date on or after today and set yearPrinted to false.
- title: short and specific (what + subject), not the whole sentence. No dates in the title.
- subject: the short name from the student's list if the deadline clearly belongs to one, else "".
- Never invent deadlines or dates that are not in the message.`
}

interface RawItem { title?: string; dueDate?: string; yearPrinted?: boolean; subject?: string; sourceLine?: string; urls?: string[] }

/** Validate Gemini's items into the same shape the Standard reader returns. */
export function toExtracted(items: RawItem[] | undefined, subjects: SubjectRef[], today: DateStr): ExtractedDeadline[] {
  const out: ExtractedDeadline[] = []
  const seen = new Set<string>()
  for (const it of items ?? []) {
    const title = (it.title ?? '').trim()
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((it.dueDate ?? '').trim())
    if (!title || !m) continue
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    if (d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) continue // not a real date
    const dueDate = `${m[1]}-${m[2]}-${m[3]}` as DateStr
    const key = `${title.toLowerCase()}|${dueDate}`
    if (seen.has(key)) continue
    seen.add(key)
    const hint = (it.subject ?? '').trim().toLowerCase()
    const subj = hint ? subjects.find((s) => s.shortName.toLowerCase() === hint) : undefined
    const urls = (it.urls ?? []).filter((u) => typeof u === 'string' && /^(https?:\/\/|www\.)/i.test(u.trim())).map((u) => u.trim())
    out.push({
      title,
      dueDate,
      subjectHint: subj?.shortName,
      // same meaning as the Standard reader: year not written AND it landed in a later year ("next year?")
      tentative: it.yearPrinted === false && m[1] > today.slice(0, 4),
      sourceLine: (it.sourceLine ?? title).trim().slice(0, 300),
      ...(urls.length ? { urls } : {}),
    })
  }
  return out
}

export interface DeadlineReadResult {
  items: ExtractedDeadline[]
  /** Holiday notices found in the same message. */
  holidays: ExtractedHoliday[]
  reader: DeadlineReader
  /** Set when Smart was chosen but the Standard reader had to be used. */
  fallbackReason?: string
}

/** Read one pasted message with the chosen reader. */
export async function readDeadlines(
  text: string,
  today: DateStr,
  subjects: SubjectRef[],
  reader: DeadlineReader,
): Promise<DeadlineReadResult> {
  if (reader === 'smart') {
    try {
      const ans = await readTextAsJson<{ deadlines?: RawItem[]; holidays?: RawHoliday[] }>({
        text: `MESSAGE:\n${text.slice(0, 30_000)}`,
        prompt: instructions(today, subjects) + HOLIDAY_RULES,
        schema: {
          type: 'object',
          properties: { deadlines: { type: 'array', items: ITEM_SCHEMA }, holidays: { type: 'array', items: HOLIDAY_SCHEMA } },
          required: ['deadlines', 'holidays'],
        },
      })
      return { items: toExtracted(ans.deadlines, subjects, today), holidays: toHolidays(ans.holidays, today), reader: 'smart' }
    } catch (err) {
      return {
        items: extractDeadlines(text, today, subjects),
        holidays: extractHolidays(text, today),
        reader: 'standard',
        fallbackReason: err instanceof Error ? err.message : 'Smart reader failed.',
      }
    }
  }
  return { items: extractDeadlines(text, today, subjects), holidays: extractHolidays(text, today), reader: 'standard' }
}

/** Read many emails at once. Smart sends them all in one request. */
export async function readDeadlinesFromMessages(
  messages: { id: string; text: string }[],
  today: DateStr,
  subjects: SubjectRef[],
  reader: DeadlineReader,
): Promise<{ byId: Map<string, ExtractedDeadline[]>; reader: DeadlineReader; fallbackReason?: string }> {
  const standard = () => new Map(messages.map((m) => [m.id, extractDeadlines(m.text, today, subjects)]))
  if (reader !== 'smart' || messages.length === 0) return { byId: standard(), reader: 'standard' }
  try {
    // keep the batch a sensible size: each email trimmed, whole batch capped
    let budget = 60_000
    const blocks: string[] = []
    const sent = new Set<string>()
    for (const m of messages) {
      const body = m.text.slice(0, 4_000)
      if (budget - body.length < 0) break
      budget -= body.length
      sent.add(m.id)
      blocks.push(`=== EMAIL id=${m.id} ===\n${body}`)
    }
    const ans = await readTextAsJson<{ emails?: { id?: string; deadlines?: RawItem[] }[] }>({
      text: blocks.join('\n\n'),
      prompt: `${instructions(today, subjects)}
There are several emails below, each starting with "=== EMAIL id=… ===". Return the deadlines per email id; emails with none can be left out.`,
      schema: {
        type: 'object',
        properties: {
          emails: {
            type: 'array',
            items: {
              type: 'object',
              properties: { id: { type: 'string' }, deadlines: { type: 'array', items: ITEM_SCHEMA } },
              required: ['id', 'deadlines'],
            },
          },
        },
        required: ['emails'],
      },
    })
    // emails that didn't fit in the batch are still read — by the Standard reader
    const byId = new Map<string, ExtractedDeadline[]>(
      messages.map((m) => [m.id, sent.has(m.id) ? [] : extractDeadlines(m.text, today, subjects)]),
    )
    for (const e of ans.emails ?? []) {
      if (e.id && sent.has(e.id)) byId.set(e.id, toExtracted(e.deadlines, subjects, today))
    }
    return { byId, reader: 'smart' }
  } catch (err) {
    return { byId: standard(), reader: 'standard', fallbackReason: err instanceof Error ? err.message : 'Smart reader failed.' }
  }
}
