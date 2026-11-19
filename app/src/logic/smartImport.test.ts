import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listGeminiModels, readFileAsJson, setGeminiKey } from './gemini'
import { coursesFromAnswer, matchCourseToSubject, normalizeTime, timetableFromAnswer } from './smartImport'
import type { Subject } from '../data/model'

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('Gemini client', () => {
  beforeEach(() => setGeminiKey('AIzaTESTKEY1234'))
  afterEach(() => vi.unstubAllGlobals())

  it('sends the file inline with the key header and a JSON schema, and parses the answer', async () => {
    const fetchFn = mockFetch(200, {
      candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }, { text: '{"ok":true}' }] }, finishReason: 'STOP' }],
    })
    const out = await readFileAsJson<{ ok: boolean }>({
      file: new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }),
      mimeType: 'application/pdf',
      prompt: 'read it',
      schema: { type: 'object' },
      model: 'gemini-flash-latest',
    })
    expect(out).toEqual({ ok: true })
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent')
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('AIzaTESTKEY1234')
    const body = JSON.parse(init.body as string)
    expect(body.contents[0].parts[0].inlineData.mimeType).toBe('application/pdf')
    expect(atob(body.contents[0].parts[0].inlineData.data)).toBe('%PDF-1.4 test')
    expect(body.generationConfig.responseMimeType).toBe('application/json')
    expect(body.generationConfig.responseJsonSchema).toEqual({ type: 'object' })
  })

  it('explains common failures in plain words', async () => {
    const file = new Blob(['x'])
    const read = () => readFileAsJson({ file, mimeType: 'application/pdf', prompt: '', schema: {} })
    mockFetch(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', details: [{ reason: 'API_KEY_INVALID' }] } })
    await expect(read()).rejects.toThrow(/key isn’t valid/)
    mockFetch(429, { error: { code: 429, message: 'Resource exhausted' } })
    await expect(read()).rejects.toThrow(/free limit/)
    mockFetch(200, { candidates: [{ content: { parts: [{ text: '{"a":' }] }, finishReason: 'MAX_TOKENS' }] })
    await expect(read()).rejects.toThrow(/too long/)
  })

  it('asks for a key when none is saved', async () => {
    setGeminiKey('')
    await expect(readFileAsJson({ file: new Blob(['x']), mimeType: 'application/pdf', prompt: '', schema: {} })).rejects.toThrow(/Add your Gemini API key/)
  })

  it('lists only text models that can read documents, default alias first', async () => {
    mockFetch(200, {
      models: [
        { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] },
        { name: 'models/gemini-flash-latest', displayName: 'Gemini Flash Latest', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-2.5-flash-preview-tts', supportedGenerationMethods: ['generateContent'] },
      ],
    })
    const models = await listGeminiModels('AIzaTESTKEY1234')
    expect(models.map((m) => m.id)).toEqual(['gemini-flash-latest', 'gemini-2.5-pro'])
  })
})

describe('Smart timetable answer → classes', () => {
  it('normalises times, batches and drops duplicates', () => {
    const r = timetableFromAnswer({
      classes: [
        { day: 'Monday', start: '8:00', end: '9:00', subject: 'fe', type: 'lab', batch: 'A1', teacher: 'PS', room: '2408' },
        { day: 'Monday', start: '8:00', end: '9:00', subject: 'FE', type: 'lab', batch: 'a1', teacher: 'PS', room: '2408' },
        { day: 'Tuesday', start: '1.15', end: '2.15', subject: 'CP', type: 'lecture', batch: 'A' },
        { day: 'Someday', start: '?', end: '', subject: 'XYZ', type: 'lecture' },
      ],
      subjects: [{ code: 'cp', name: 'Computer Programming' }],
    })
    expect(r.entries).toHaveLength(3)
    expect(r.entries[0]).toMatchObject({ weekday: 1, startTime: '08:00', endTime: '09:00', batch: 'A1', subjectShort: 'FE', type: 'lab' })
    expect(r.entries[1]).toMatchObject({ weekday: 2, startTime: '13:15', endTime: '14:15', batch: undefined })
    expect(r.entries[2].needsReview).toBe(true)
    expect(r.subjects).toEqual([{ short: 'CP', full: 'Computer Programming' }])
    expect(r.batches).toEqual(['A1'])
  })

  it('reads 12-hour times with am/pm', () => {
    expect(normalizeTime('2:15 PM')).toBe('14:15')
    expect(normalizeTime('12:15 pm')).toBe('12:15')
    expect(normalizeTime('9.00')).toBe('09:00')
    expect(normalizeTime('nonsense')).toBeNull()
  })
})

describe('Smart syllabus answer → courses', () => {
  const subjects: Subject[] = [
    { id: 'cp', shortName: 'CP', fullName: 'Computer Programming', nicknames: [] },
    { id: 'sdc', shortName: 'SDC', fullName: 'SDC', nicknames: [] },
    { id: 'vaco', shortName: 'VACO-I', fullName: 'Value added career orientation I', nicknames: [] },
  ]

  it('cleans the answer and keeps every unit and topic', () => {
    const [c] = coursesFromAnswer({
      courses: [{
        courseName: ' Computer Programming ', shortName: 'CP', credits: 4,
        units: [
          { number: '1', title: 'Basics of C', hours: 8, topics: ['Tokens', ' Data types ', ''] },
          { title: '', topics: [] },
        ],
        textbooks: ['Let Us C'],
      }],
    })
    expect(c.courseName).toBe('Computer Programming')
    expect(c.units).toHaveLength(1)
    expect(c.units[0].topics).toEqual(['Tokens', 'Data types'])
    expect(c.textbooks).toEqual(['Let Us C'])
  })

  it('matches courses to subjects by code, name or acronym', () => {
    const units = [{ title: 'U', topics: [] }]
    expect(matchCourseToSubject({ courseName: 'Whatever', shortName: 'CP', units }, subjects)).toBe('cp')
    expect(matchCourseToSubject({ courseName: 'Statistics and Differential Calculus', units }, subjects)).toBe('sdc')
    expect(matchCourseToSubject({ courseName: 'Value Added Career Orientation - I', units }, subjects)).toBe('vaco')
    expect(matchCourseToSubject({ courseName: 'Engineering Graphics', units }, subjects)).toBeNull()
  })
})
