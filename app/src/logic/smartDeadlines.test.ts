import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setGeminiKey } from './gemini'
import { deadlineReaderOf, readDeadlines, readDeadlinesFromMessages, toExtracted } from './smartDeadlines'

const subjects = [
  { shortName: 'WAD', fullName: 'Web Application Development' },
  { shortName: 'CP', fullName: 'Computer Programming' },
]

function answer(obj: unknown) {
  const fn = vi.fn(async () =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] }, finishReason: 'STOP' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('Smart deadline reader', () => {
  beforeEach(() => setGeminiKey('AIzaTESTKEY1234'))
  afterEach(() => vi.unstubAllGlobals())

  it('is only used when chosen AND a key is saved', () => {
    expect(deadlineReaderOf({ deadlineReader: 'smart' })).toBe('smart')
    expect(deadlineReaderOf({ deadlineReader: 'standard' })).toBe('standard')
    expect(deadlineReaderOf({})).toBe('standard')
    setGeminiKey('')
    expect(deadlineReaderOf({ deadlineReader: 'smart' })).toBe('standard')
  })

  it('validates what Gemini returns', () => {
    const out = toExtracted(
      [
        { title: 'WAD lab file', dueDate: '2026-11-25', yearPrinted: false, subject: 'wad', sourceLine: 'Submit WAD lab file by 25/11', urls: ['https://x.com/f', 'not a url'] },
        { title: 'WAD lab file', dueDate: '2026-11-25', sourceLine: 'dup' }, // duplicate
        { title: 'Bad date', dueDate: '2026-02-31', sourceLine: '' }, // not a real date
        { title: '', dueDate: '2026-12-01', sourceLine: '' }, // no title
        { title: 'Quiz', dueDate: '2026-12-01', subject: 'XYZ', sourceLine: 'Quiz on 1 Dec', yearPrinted: true },
        { title: 'Exam', dueDate: '2027-01-10', yearPrinted: false, sourceLine: 'Exam on 10 Jan' },
      ],
      subjects,
      '2026-11-19',
    )
    expect(out).toEqual([
      { title: 'WAD lab file', dueDate: '2026-11-25', subjectHint: 'WAD', tentative: false, sourceLine: 'Submit WAD lab file by 25/11', urls: ['https://x.com/f'] },
      { title: 'Quiz', dueDate: '2026-12-01', subjectHint: undefined, tentative: false, sourceLine: 'Quiz on 1 Dec' },
      // year not written and rolled into next year → "next year?" like the Standard reader
      { title: 'Exam', dueDate: '2027-01-10', subjectHint: undefined, tentative: true, sourceLine: 'Exam on 10 Jan' },
    ])
  })

  it('reads a pasted message with Gemini, sending today and the subject list', async () => {
    const fetchFn = answer({ deadlines: [{ title: 'CP assignment 3', dueDate: '2026-11-27', yearPrinted: false, subject: 'CP', sourceLine: 'CP assignment 3 next Friday' }] })
    const r = await readDeadlines('CP assignment 3 next Friday', '2026-11-19', subjects, 'smart')
    expect(r.reader).toBe('smart')
    expect(r.items.map((i) => i.title)).toEqual(['CP assignment 3'])
    const body = JSON.parse((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    const prompt = body.contents[0].parts[0].text as string
    expect(prompt).toContain('Today is 2026-11-19')
    expect(prompt).toContain('CP (Computer Programming)')
  })

  it('falls back to the Standard reader and says why', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 429, message: 'quota' } }), { status: 429 })))
    const r = await readDeadlines('WAD assignment submission on 25/11', '2026-11-19', subjects, 'smart')
    expect(r.reader).toBe('standard')
    expect(r.fallbackReason).toMatch(/free limit/)
    expect(r.items[0].dueDate).toBe('2026-11-25')
  })

  it('reads many emails in ONE request', async () => {
    const fetchFn = answer({ emails: [{ id: 'm2', deadlines: [{ title: 'Fee payment', dueDate: '2026-12-05', sourceLine: 'Pay fees by 5 Dec' }] }] })
    const r = await readDeadlinesFromMessages(
      [{ id: 'm1', text: 'Hello, welcome to college' }, { id: 'm2', text: 'Pay fees by 5 Dec' }],
      '2026-11-19',
      subjects,
      'smart',
    )
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(r.byId.get('m1')).toEqual([])
    expect(r.byId.get('m2')?.[0].title).toBe('Fee payment')
  })
})
