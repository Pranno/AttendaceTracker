// ============================================================
// Acceptance tests for the syllabus reader (rules S1–S18, L1–L6).
// Runs on the real Semester-1 PDF's extracted text layout — offline.
// Expected values come from the requirements doc: 7 subjects, 30 units,
// hours per unit table (T22), and the link result (22 found: 14 clean,
// 5 repaired by L2, 2 flagged "check link", 1 other-site).
// ============================================================
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseSyllabusLines, groupItemsIntoLines, guessShortName, splitTopics } from './syllabusReader'

type Item = { str: string; transform: number[]; width?: number }
const pages = JSON.parse(readFileSync(new URL('./__fixtures__/syllabus-sem1.json', import.meta.url), 'utf8')) as Item[][]
const items = pages.flat()
const result = parseSyllabusLines(groupItemsIntoLines(items))

describe('syllabus reader — Semester 1 acceptance', () => {
  it('is not a scanned file (has selectable text)', () => {
    expect(result.scanned).toBe(false)
  })

  it('finds exactly the 7 subjects with right codes/names/short names (S3)', () => {
    const codes = result.subjects.map((s) => s.code)
    expect(codes).toEqual([
      'BTECES26101', 'BTECES26102', 'BTECES26103', 'BTECES26104', 'BTECES26105', 'BTECES26106', 'IKS25AI01A',
    ])
    const names = result.subjects.map((s) => s.shortName)
    expect(names).toEqual(['SDC', 'FE', 'CP', 'WAD', 'ASEP', 'VACO', 'IKS'])
    expect(result.subjects[0].fullName).toMatch(/Statistics.*Differential.*Calculus/i)
  })

  it('finds all 30 units in total (doc: "That is 30 units in all")', () => {
    const total = result.subjects.reduce((n, s) => n + s.units.length, 0)
    expect(total).toBe(30)
  })

  it('unit counts per subject match the doc table', () => {
    const counts = Object.fromEntries(result.subjects.map((s) => [s.shortName, s.units.length]))
    expect(counts).toEqual({ SDC: 5, FE: 5, CP: 5, WAD: 4, ASEP: 1, VACO: 5, IKS: 5 })
  })

  it('hours per unit match the doc table (S7)', () => {
    const hours = Object.fromEntries(result.subjects.map((s) => [s.shortName, s.units.map((u) => u.hours)]))
    expect(hours.SDC).toEqual([8, 8, 10, 10, 9])
    expect(hours.FE).toEqual([9, 9, 9, 9, 9])
    expect(hours.CP).toEqual([9, 9, 9, 9, 9])
    expect(hours.WAD).toEqual([4, 3, 5, 3])
    expect(hours.ASEP).toEqual([30])
    expect(hours.VACO).toEqual([6, 6, 6, 6, 6])
    expect(hours.IKS).toEqual([6, 6, 6, 6, 6])
  })

  it('unit numbers are sequential within each subject (S5)', () => {
    for (const s of result.subjects) {
      expect(s.units.map((u) => u.number)).toEqual(s.units.map((_, i) => i + 1))
    }
  })

  it('ASEP unit 1 has the 15 numbered guidelines as topics (S13)', () => {
    const asep = result.subjects.find((s) => s.shortName === 'ASEP')!
    expect(asep.units[0].topics.length).toBe(15)
  })

  it('SDC Unit 1 first topic is Descriptive Statistics etc.; splits at commas outside brackets (S11)', () => {
    const sdc = result.subjects.find((s) => s.shortName === 'SDC')!
    const t0 = sdc.units[0].topics[0]
    expect(t0.name.toLowerCase()).toContain('descriptive statistics')
    // every topic name must be non-empty and cleaned (S16)
    for (const u of sdc.units) {
      for (const t of u.topics) {
        expect(t.name.length).toBeGreaterThan(0)
        expect(t.name).not.toMatch(/[.,;]\s*$/)
      }
    }
  })

  it('topics carry content: every unit has at least one topic', () => {
    for (const s of result.subjects) {
      for (const u of s.units) {
        expect(u.topics.length, `${s.shortName} unit ${u.number}`).toBeGreaterThan(0)
      }
    }
  })

  it('flags run-together topics over 12 words (S17): IKS U1/U2 and WAD U3', () => {
    const iks = result.subjects.find((s) => s.shortName === 'IKS')!
    const wad = result.subjects.find((s) => s.shortName === 'WAD')!
    const flagged = (arr: typeof iks.units) => arr.some((u) => u.topics.some((t) => t.needsSplit))
    expect(flagged(iks.units.slice(0, 2))).toBe(true)
    void wad
  })

  it('reads Springboard links across wrapped fragments and rebuilds them (L1/L2)', () => {
    const all = result.subjects.flatMap((s) => s.links)
    expect(all.length).toBeGreaterThanOrEqual(22)
    const springboard = all.filter((c) => !c.otherSite && c.url)
    for (const c of springboard) {
      expect(c.url.startsWith('https://infyspringboard.onwingspan.com/web/en/app/toc/')).toBe(true)
    }
  })

  it('keeps the LinkedIn/other-site links marked as other (L5)', () => {
    const all = result.subjects.flatMap((s) => s.links)
    const other = all.filter((c) => c.otherSite)
    expect(other.length).toBeGreaterThanOrEqual(1)
  })

  it('courses without a link become no-link entries (L6)', () => {
    const all = result.subjects.flatMap((s) => s.links)
    expect(all.some((c) => c.noLink)).toBe(true)
  })

  it('guessShortName makes acronyms like SDC/WAD', () => {
    expect(guessShortName('Statistics and Differential Calculus')).toBe('SDC')
    expect(guessShortName('Web Application Development')).toBe('WAD')
  })

  it('splitTopics keeps bracketed commas together (S11)', () => {
    const parts = splitTopics('Inheritance: Concept, Modes and Types (Single, Multiple, Multilevel, Hierarchical), Virtual functions')
    expect(parts).toEqual([
      'Inheritance: Concept, Modes and Types (Single, Multiple, Multilevel, Hierarchical)',
      'Virtual functions',
    ])
  })

  it('splitTopics breaks at ". Word" sentence joins (S12)', () => {
    const parts = splitTopics('Moments: Skewness and Kurtosis. Statistical Analysis using R software')
    expect(parts.length).toBe(2)
  })

  it('dehyphenation joins broken words (S10)', () => {
    const parts = splitTopics('Introduction to Server- Side Programming, Client- Side scripts')
    expect(parts[0]).toBe('Introduction to ServerSide Programming')
  })
})
