// Bridge to the Android app's native Gmail sign-in (GmailAuthPlugin.java).
// On the phone, sign-in uses the Google account picker and Google Play
// Services hands out Gmail read-only tokens — no client ID, no redirect.

import { Capacitor, registerPlugin } from '@capacitor/core'
import type { AppSettings } from '../data/model'
import { AUTO_ADD_DEFAULT, collegeDomainOf, importantSubjectPattern } from './deadlineCategory'

interface GmailAuthPlugin {
  signingInfo(): Promise<{ packageName: string; sha1: string }>
  status(): Promise<{ connected: boolean; email: string | null }>
  signIn(): Promise<{ accessToken: string; email: string }>
  getToken(): Promise<{ accessToken: string; email: string }>
  clearToken(opts: { token: string }): Promise<void>
  signOut(): Promise<void>
}

const GmailAuth = registerPlugin<GmailAuthPlugin>('GmailAuth')

/** Native Gmail sign-in is used inside the Android app. */
export function useNativeGmail(): boolean {
  return Capacitor.getPlatform() === 'android'
}

let cached: { token: string; at: number } | null = null
const TOKEN_TTL_MS = 45 * 60 * 1000 // Google access tokens last ~1 h

function messageOf(err: unknown): string {
  return (err as { message?: string })?.message || 'Google sign-in failed.'
}

export async function nativeSignIn(): Promise<string> {
  try {
    const r = await GmailAuth.signIn()
    cached = { token: r.accessToken, at: Date.now() }
    return r.email
  } catch (err) {
    throw new Error(messageOf(err))
  }
}

export async function nativeToken(forceNew = false): Promise<string> {
  if (!forceNew && cached && Date.now() - cached.at < TOKEN_TTL_MS) return cached.token
  if (forceNew && cached) await GmailAuth.clearToken({ token: cached.token }).catch(() => {})
  try {
    const r = await GmailAuth.getToken()
    cached = { token: r.accessToken, at: Date.now() }
    return r.accessToken
  } catch (err) {
    cached = null
    throw new Error(messageOf(err))
  }
}

export async function nativeStatus(): Promise<{ connected: boolean; email: string | null }> {
  try {
    return await GmailAuth.status()
  } catch {
    return { connected: false, email: null }
  }
}

export async function nativeSignOut(): Promise<void> {
  cached = null
  await GmailAuth.signOut().catch(() => {})
}

export async function nativeSigningInfo(): Promise<{ packageName: string; sha1: string } | null> {
  try {
    return await GmailAuth.signingInfo()
  } catch {
    return null
  }
}

interface BackgroundPlugin {
  scheduleBackgroundCheck(o: { enabled: boolean; pattern: string; domain: string }): Promise<void>
  takeNotified(): Promise<{ ids: string[] }>
}
const GmailBg = registerPlugin<BackgroundPlugin>('GmailAuth')

/** Android: keep the hourly background check of college email in step with Settings. */
export async function syncBackgroundEmailCheck(settings: AppSettings): Promise<void> {
  if (!useNativeGmail()) return
  const st = await nativeStatus()
  const enabled = st.connected && settings.emailBackgroundCheck !== false
  const domain = settings.emailCollegeOnly !== false ? collegeDomainOf(st.email) ?? '' : ''
  const pattern = importantSubjectPattern(settings.emailAutoAddCategories ?? AUTO_ADD_DEFAULT)
  await GmailBg.scheduleBackgroundCheck({ enabled, pattern, domain }).catch(() => {})
}

/** Email ids the background check already sent a notification about (cleared once read). */
export async function backgroundNotifiedIds(): Promise<string[]> {
  if (!useNativeGmail()) return []
  try {
    return (await GmailBg.takeNotified()).ids ?? []
  } catch {
    return []
  }
}
