// Google Gemini API client for Smart import (timetable + syllabus).
// The user brings their own API key (Settings → Smart import). It is kept in
// its own localStorage entry — NOT in the app data — so it never ends up in
// an exported backup. Requests go straight from the phone to Google.
//
// REST shape (checked against @google/genai 3.6.1): base
// https://generativelanguage.googleapis.com/v1beta, key in the
// `x-goog-api-key` header, files as `inlineData: { mimeType, data }`, JSON
// output via generationConfig.responseMimeType + responseJsonSchema.

import { blobToBase64 } from './nativeFiles'

const BASE = 'https://generativelanguage.googleapis.com/v1beta'
const KEY_STORE = 'at.gemini.key.v1'
const MODEL_STORE = 'at.gemini.model.v1'

/** Alias that always points at Google's newest Flash model (fast, free tier). */
export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest'

/** Inline uploads must fit in one request (~20 MB after base64, which adds a third). */
export const MAX_SMART_FILE_BYTES = 14 * 1024 * 1024

export const AI_STUDIO_KEY_URL = 'https://aistudio.google.com/apikey'

// ---------- settings ----------

export function getGeminiKey(): string {
  try {
    return localStorage.getItem(KEY_STORE)?.trim() ?? ''
  } catch {
    return ''
  }
}

export function setGeminiKey(key: string): void {
  try {
    const k = key.trim()
    if (k) localStorage.setItem(KEY_STORE, k)
    else localStorage.removeItem(KEY_STORE)
  } catch {
    /* storage unavailable */
  }
}

export function getGeminiModel(): string {
  try {
    return localStorage.getItem(MODEL_STORE)?.trim() || DEFAULT_GEMINI_MODEL
  } catch {
    return DEFAULT_GEMINI_MODEL
  }
}

export function setGeminiModel(model: string): void {
  try {
    if (model.trim()) localStorage.setItem(MODEL_STORE, model.trim())
    else localStorage.removeItem(MODEL_STORE)
  } catch {
    /* storage unavailable */
  }
}

export function hasGeminiKey(): boolean {
  return getGeminiKey().length > 0
}

/** Show only the start and end of a key ("AIza…3fQk"). */
export function maskKey(key: string): string {
  return key.length <= 10 ? '••••' : `${key.slice(0, 4)}…${key.slice(-4)}`
}

// ---------- errors ----------

export class GeminiError extends Error {}

interface GoogleErrorBody {
  error?: { code?: number; message?: string; status?: string; details?: { reason?: string }[] }
}

/** Turn Google's error replies into something a student can act on. */
export function friendlyError(status: number, body: GoogleErrorBody | null): GeminiError {
  const msg = body?.error?.message ?? ''
  const reason = body?.error?.details?.map((d) => d.reason ?? '').join(' ') ?? ''
  if (/API_KEY_INVALID|API key not valid|API key expired/i.test(`${msg} ${reason}`) || status === 401) {
    return new GeminiError('Your Gemini API key isn’t valid. Check it in Settings → Smart import (AI).')
  }
  if (status === 429) {
    return new GeminiError('Gemini’s free limit was reached for now. Wait a minute and try again.')
  }
  if (status === 403) {
    return new GeminiError(`Google refused the request${msg ? `: ${msg}` : ''}. Check that the key is from Google AI Studio.`)
  }
  if (status === 404) {
    return new GeminiError('That Gemini model isn’t available for your key. Pick another model in Settings → Smart import (AI).')
  }
  if (status === 413 || /too large|payload/i.test(msg)) {
    return new GeminiError('The file is too large for Smart import. Try a smaller PDF or a photo of the page.')
  }
  if (status >= 500) {
    return new GeminiError('Gemini is busy right now. Try again in a moment.')
  }
  return new GeminiError(msg ? `Gemini error: ${msg}` : `Gemini error (${status}).`)
}

async function call(path: string, key: string, init: RequestInit = {}, timeoutMs = 60_000): Promise<unknown> {
  if (!key) throw new GeminiError('Add your Gemini API key in Settings → Smart import (AI) first.')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(`${BASE}/${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    })
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw new GeminiError('Gemini took too long to answer. Try again.')
    throw new GeminiError('Couldn’t reach Google. Check your internet connection.')
  } finally {
    clearTimeout(timer)
  }
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    /* empty or non-JSON body */
  }
  if (!res.ok) throw friendlyError(res.status, body as GoogleErrorBody | null)
  return body
}

// ---------- models ----------

export interface GeminiModel {
  /** id without the "models/" prefix, e.g. "gemini-flash-latest" */
  id: string
  displayName: string
}

/** Models this key can use to read documents (text generation only). */
export async function listGeminiModels(key: string): Promise<GeminiModel[]> {
  const body = (await call('models?pageSize=1000', key, { method: 'GET' })) as {
    models?: { name?: string; displayName?: string; supportedGenerationMethods?: string[] }[]
  }
  const out: GeminiModel[] = []
  for (const m of body?.models ?? []) {
    const id = (m.name ?? '').replace(/^models\//, '')
    if (!id.startsWith('gemini')) continue
    if (!(m.supportedGenerationMethods ?? []).includes('generateContent')) continue
    // skip models made for other jobs (speech, images, live audio, embeddings…)
    if (/embedding|tts|audio|image|live|robotics|banana|veo|imagen|computer-use/i.test(id)) continue
    out.push({ id, displayName: m.displayName || id })
  }
  // newest-looking "latest"/flash first
  const rank = (id: string) => (id === DEFAULT_GEMINI_MODEL ? 0 : /latest/.test(id) ? 1 : /flash/.test(id) ? 2 : 3)
  return out.sort((a, b) => rank(a.id) - rank(b.id) || b.id.localeCompare(a.id))
}

// ---------- reading a file ----------

interface GenerateResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[]
  promptFeedback?: { blockReason?: string }
}

/** Send one file + instructions and get JSON back that matches `schema`. */
export async function readFileAsJson<T>(opts: {
  file: Blob
  mimeType: string
  prompt: string
  /** JSON Schema (the subset Gemini supports) describing the answer. */
  schema: Record<string, unknown>
  key?: string
  model?: string
}): Promise<T> {
  const key = opts.key ?? getGeminiKey()
  const model = opts.model ?? getGeminiModel()
  if (!key) throw new GeminiError('Add your Gemini API key in Settings → Smart import (AI) first.')
  if (opts.file.size > MAX_SMART_FILE_BYTES) {
    throw new GeminiError(`The file is over ${Math.round(MAX_SMART_FILE_BYTES / 1024 / 1024)} MB — too big for Smart import.`)
  }
  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ inlineData: { mimeType: opts.mimeType, data: await blobToBase64(opts.file) } }, { text: opts.prompt }],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema: opts.schema,
      temperature: 0,
    },
  }
  const res = (await call(
    `models/${encodeURIComponent(model)}:generateContent`,
    key,
    { method: 'POST', body: JSON.stringify(body) },
    180_000,
  )) as GenerateResponse
  if (res?.promptFeedback?.blockReason) {
    throw new GeminiError('Gemini refused to read this file. Try another copy of it.')
  }
  const cand = res?.candidates?.[0]
  const text = (cand?.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text)
    .join('')
  if (cand?.finishReason === 'MAX_TOKENS') {
    throw new GeminiError('The document was too long to read in one go. Upload one subject (or fewer pages) at a time.')
  }
  if (!text.trim()) throw new GeminiError('Gemini returned nothing for this file. Try again, or try a clearer copy.')
  try {
    return JSON.parse(text) as T
  } catch {
    throw new GeminiError('Gemini’s answer couldn’t be read. Try again.')
  }
}
