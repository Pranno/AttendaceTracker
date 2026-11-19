// Smart import: Gemini reads a timetable or syllabus (PDF or photo) and
// returns structured JSON, which is turned into the app's own records here.
// Everything still goes through the normal review screen before saving.

import type { Subject, Syllabus, SyllabusUnit } from '../data/model'
import { readFileAsJson } from './gemini'
import { guessType } from './fileStore'
import { collegeHour, distinctBatches, weekdayFromName, type GridParseResult, type ParsedEntry } from './timetableImport'

export function smartMimeType(file: File): string {
  return guessType(file.name, file.type)
}

/** Smart import reads PDFs and images only. */
export function isSmartReadable(file: File): boolean {
  return /^(application\/pdf|image\/(png|jpe?g|webp|heic|heif))$/.test(smartMimeType(file))
}

// ======================= Timetable =======================

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const TIMETABLE_SCHEMA = {
  type: 'object',
  properties: {
    classes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          day: { type: 'string', enum: DAYS },
          start: { type: 'string', description: 'Start time, 24-hour HH:MM' },
          end: { type: 'string', description: 'End time, 24-hour HH:MM' },
          subject: { type: 'string', description: 'Course code / abbreviation exactly as printed in the cell, e.g. CP, SDC, VACO-I' },
          type: { type: 'string', enum: ['lecture', 'lab', 'tutorial'] },
          batch: { type: 'string', description: 'Batch tag such as A1 or B2; empty string when the whole class attends' },
          teacher: { type: 'string', description: 'Teacher initials as printed, or empty' },
          room: { type: 'string', description: 'Room number as printed, or empty' },
        },
        required: ['day', 'start', 'end', 'subject', 'type'],
      },
    },
    subjects: {
      type: 'array',
      description: 'The abbreviation legend: every course code with its full name',
      items: {
        type: 'object',
        properties: { code: { type: 'string' }, name: { type: 'string' } },
        required: ['code', 'name'],
      },
    },
  },
  required: ['classes', 'subjects'],
}

const TIMETABLE_PROMPT = `This is a college class timetable (a weekly grid). Read EVERY class in it.
Rules:
- One entry per class. If a cell lists several batches (e.g. "A1 FE (P) ... / A2 WAD (P) ..."), give one entry per batch.
- If one class spans two or more consecutive periods (e.g. a 2-hour lab), give ONE entry from the start of the first period to the end of the last.
- Times in 24-hour HH:MM. Afternoon times printed without am/pm ("1.15 - 2.15", "4.30 - 5.30") are PM: 13:15-14:15, 16:30-17:30.
- Type from the marker: (L) = lecture, (P) = lab/practical, (T) = tutorial; (S) studio = tutorial. No marker = lecture.
- batch: the batch tag before the subject (A1, B2, F3…). A bare division letter (just "A") or no tag means the whole class: use "".
- subject: the course code/abbreviation exactly as printed (keep suffixes like "-I").
- Skip breaks, lunch, empty cells, notes and the legend itself.
- Also return the abbreviation legend (code → full course name) if the document has one.
Do not invent anything that is not printed.`

interface SmartTimetableAnswer {
  classes?: { day?: string; start?: string; end?: string; subject?: string; type?: string; batch?: string; teacher?: string; room?: string }[]
  subjects?: { code?: string; name?: string }[]
}

/** "8:00", "08.00", "1:15 pm", "13:15" → "HH:MM" (24 h), or null. */
export function normalizeTime(raw: string | undefined): string | null {
  const m = /(\d{1,2})\s*[:.]\s*(\d{2})\s*(am|pm|a\.m\.|p\.m\.)?/i.exec(raw ?? '')
  if (!m) return null
  let h = Number(m[1])
  const mi = Number(m[2])
  const ap = m[3]?.toLowerCase().replace(/\./g, '')
  if (ap === 'pm' && h < 12) h += 12
  else if (ap === 'am' && h === 12) h = 0
  else if (!ap) h = collegeHour(h)
  if (h > 23 || mi > 59) return null
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`
}

/** Convert Gemini's answer into the same shape the rule-based reader returns. */
export function timetableFromAnswer(ans: SmartTimetableAnswer): GridParseResult {
  const entries: ParsedEntry[] = []
  for (const c of ans.classes ?? []) {
    const weekday = weekdayFromName(c.day ?? '') ?? 0
    const start = normalizeTime(c.start)
    const end = normalizeTime(c.end)
    const subject = (c.subject ?? '').trim().toUpperCase().replace(/\s+/g, ' ')
    if (!subject) continue
    const tag = (c.batch ?? '').trim().toUpperCase()
    const type = c.type === 'lab' || c.type === 'tutorial' ? c.type : 'lecture'
    const ok = weekday >= 1 && !!start && !!end && end > start
    entries.push({
      raw: `${c.day ?? '?'} ${c.start ?? '?'}-${c.end ?? '?'}: ${subject}${tag ? ` (${tag})` : ''} — Smart import`,
      // a bare division letter means the whole class
      batch: /^[A-Z][1-9]\d?$/.test(tag) ? tag : undefined,
      subjectShort: subject,
      type,
      teacher: (c.teacher ?? '').trim(),
      room: (c.room ?? '').trim(),
      weekday: ok ? weekday : 0,
      startTime: ok ? start! : '',
      endTime: ok ? end! : '',
      needsReview: !ok,
      note: ok ? undefined : 'Day or time unclear',
    })
  }
  // drop exact duplicates (same class read twice)
  const seen = new Set<string>()
  const unique = entries.filter((e) => {
    const k = `${e.weekday}|${e.startTime}|${e.endTime}|${e.batch ?? ''}|${e.subjectShort}|${e.type}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  const subjects = (ans.subjects ?? [])
    .map((s) => ({ short: (s.code ?? '').trim().toUpperCase(), full: (s.name ?? '').trim() }))
    .filter((s) => s.short && s.full)
  const warnings: string[] = []
  if (unique.length === 0) warnings.push('Smart import found no classes in this file.')
  if (unique.some((e) => e.needsReview)) warnings.push('Some classes had an unclear day or time — they are listed for you to fix or remove.')
  return { entries: unique, batches: distinctBatches(unique), subjects, warnings }
}

export async function smartReadTimetable(file: File): Promise<GridParseResult> {
  const ans = await readFileAsJson<SmartTimetableAnswer>({
    file,
    mimeType: smartMimeType(file),
    prompt: TIMETABLE_PROMPT,
    schema: TIMETABLE_SCHEMA,
  })
  return timetableFromAnswer(ans)
}

// ======================= Syllabus =======================

const strArr = (description: string) => ({ type: 'array', description, items: { type: 'string' } })

const SYLLABUS_SCHEMA = {
  type: 'object',
  properties: {
    courses: {
      type: 'array',
      description: 'One entry per course/subject in the document',
      items: {
        type: 'object',
        properties: {
          courseCode: { type: 'string', description: 'Course code as printed, e.g. "CS1001" or the short form like "CP"' },
          shortName: { type: 'string', description: 'Abbreviation if printed, e.g. CP, SDC, WAD' },
          courseName: { type: 'string' },
          credits: { type: 'number' },
          teachingScheme: { type: 'string', description: 'Lecture-Tutorial-Practical hours, e.g. "3-0-2"' },
          prerequisites: strArr('Prerequisite courses'),
          objectives: strArr('Course objectives, one per item'),
          outcomes: {
            type: 'array',
            description: 'Course outcomes',
            items: { type: 'object', properties: { code: { type: 'string' }, text: { type: 'string' } }, required: ['text'] },
          },
          units: {
            type: 'array',
            description: 'Every unit/module in order',
            items: {
              type: 'object',
              properties: {
                number: { type: 'string', description: 'Unit number as printed: "1", "II", "Module 3"' },
                title: { type: 'string' },
                hours: { type: 'number', description: 'Teaching hours for the unit if printed' },
                topics: strArr('Every topic in the unit, one per item, in printed order'),
                outcomes: strArr('Course outcome codes mapped to this unit, e.g. CO1'),
              },
              required: ['title', 'topics'],
            },
          },
          practicals: strArr('Lab experiments / practical list, one per item'),
          assessment: {
            type: 'array',
            description: 'Evaluation / examination scheme',
            items: { type: 'object', properties: { component: { type: 'string' }, weight: { type: 'string' } }, required: ['component'] },
          },
          textbooks: strArr('Text books, one per item'),
          references: strArr('Reference books, one per item'),
          links: {
            type: 'array',
            description: 'Online courses / web links printed in the syllabus (NPTEL, Coursera, etc.)',
            items: { type: 'object', properties: { name: { type: 'string' }, url: { type: 'string' } }, required: ['name'] },
          },
        },
        required: ['courseName', 'units'],
      },
    },
  },
  required: ['courses'],
}

const SYLLABUS_PROMPT = `This is a university course syllabus. It may contain one course or several.
For EACH course, extract everything printed, in detail:
- course code, abbreviation, full name, credits, teaching scheme, prerequisites
- objectives and course outcomes (with their codes like CO1)
- EVERY unit/module in order with its number, title, hours and ALL its topics — split the unit text into individual topics, one per item, keeping the wording
- lab/practical experiment list, evaluation scheme, text books, reference books, and any online course links
Rules: copy what is printed — do not summarise away topics, and do not invent anything that is not in the document. Leave out fields that are not printed.`

export interface SmartCourse extends Omit<Syllabus, 'subjectId' | 'sourceName' | 'importedAt'> {
  shortName?: string
}

interface SmartSyllabusAnswer {
  courses?: (Partial<SmartCourse> & { units?: Partial<SyllabusUnit>[] })[]
}

const cleanList = (xs: unknown): string[] | undefined => {
  if (!Array.isArray(xs)) return undefined
  const out = xs.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean)
  return out.length ? out : undefined
}

export function coursesFromAnswer(ans: SmartSyllabusAnswer): SmartCourse[] {
  const out: SmartCourse[] = []
  for (const c of ans.courses ?? []) {
    const units: SyllabusUnit[] = (c.units ?? [])
      .map((u) => ({
        number: u.number?.toString().trim() || undefined,
        title: (u.title ?? '').trim(),
        hours: typeof u.hours === 'number' && u.hours > 0 ? u.hours : undefined,
        topics: cleanList(u.topics) ?? [],
        outcomes: cleanList(u.outcomes),
      }))
      .filter((u) => u.title || u.topics.length)
    const name = (c.courseName ?? '').trim()
    if (!name && units.length === 0) continue
    out.push({
      courseCode: c.courseCode?.trim() || undefined,
      shortName: c.shortName?.trim() || undefined,
      courseName: name || undefined,
      credits: typeof c.credits === 'number' && c.credits > 0 ? c.credits : undefined,
      teachingScheme: c.teachingScheme?.trim() || undefined,
      prerequisites: cleanList(c.prerequisites),
      objectives: cleanList(c.objectives),
      outcomes: Array.isArray(c.outcomes)
        ? c.outcomes.filter((o) => o && typeof o.text === 'string' && o.text.trim()).map((o) => ({ code: o.code?.trim() || undefined, text: o.text.trim() }))
        : undefined,
      units,
      practicals: cleanList(c.practicals),
      assessment: Array.isArray(c.assessment)
        ? c.assessment.filter((a) => a && a.component?.trim()).map((a) => ({ component: a.component.trim(), weight: a.weight?.trim() || undefined }))
        : undefined,
      textbooks: cleanList(c.textbooks),
      references: cleanList(c.references),
      links: Array.isArray(c.links)
        ? c.links.filter((l) => l && l.name?.trim()).map((l) => ({ name: l.name.trim(), url: l.url?.trim() || undefined }))
        : undefined,
    })
  }
  return out
}

export async function smartReadSyllabus(file: File): Promise<SmartCourse[]> {
  const ans = await readFileAsJson<SmartSyllabusAnswer>({
    file,
    mimeType: smartMimeType(file),
    prompt: SYLLABUS_PROMPT,
    schema: SYLLABUS_SCHEMA,
  })
  return coursesFromAnswer(ans)
}

// ---------- which subject a course belongs to ----------

const norm = (s: string | undefined) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
const STOP = new Set(['AND', 'OF', 'THE', 'FOR', 'IN', 'TO', 'A', 'AN', 'WITH', 'I', 'II', 'III', 'IV'])
const words = (s: string | undefined) => norm(s).split(' ').filter((w) => w && !STOP.has(w))
/** "Statistics and Differential Calculus" → "SDC" */
const acronym = (s: string | undefined) => words(s).map((w) => w[0]).join('')

/** Best-matching subject id for a course read from a syllabus, or null. */
export function matchCourseToSubject(course: SmartCourse, subjects: Subject[]): string | null {
  const codes = [course.shortName, course.courseCode].map(norm).filter(Boolean)
  const name = norm(course.courseName)
  let best: { id: string; score: number } | null = null
  for (const s of subjects) {
    const short = norm(s.shortName)
    const shortBase = short.replace(/ (I|II|III|IV)$/, '')
    let score = 0
    if (codes.some((c) => c === short || c.replace(/ (I|II|III|IV)$/, '') === shortBase)) score = 100
    else if (name && name === norm(s.fullName)) score = 95
    else if (short && acronym(course.courseName) === shortBase.replace(/ /g, '')) score = 80
    else {
      const a = new Set(words(course.courseName))
      const b = words(s.fullName)
      if (a.size && b.length) {
        const overlap = b.filter((w) => a.has(w)).length / Math.max(a.size, b.length)
        if (overlap >= 0.6) score = Math.round(overlap * 70)
      }
    }
    if (score > (best?.score ?? 0)) best = { id: s.id, score }
  }
  return best ? best.id : null
}

/** A course read from the file, ready to save under a subject. */
export function syllabusFor(course: SmartCourse, subjectId: string, sourceName: string): Syllabus {
  const { shortName: _short, ...rest } = course
  void _short
  return { ...rest, subjectId, sourceName, importedAt: new Date().toISOString() }
}
