import { afterEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  useNativeGmail: vi.fn(() => true),
  nativeToken: vi.fn(async (force?: boolean) => (force ? 'fresh-token' : 'old-token')),
  nativeStatus: vi.fn(async () => ({ connected: true, email: 'me@college.edu' })),
  nativeSignOut: vi.fn(async () => {}),
}))
vi.mock('./gmailNative', () => native)

import { connectedEmail, fetchInbox, hasGmailSetup, isConnected } from './gmail'

describe('Gmail in the Android app (native sign-in)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('needs no client ID and reports the connected account', async () => {
    expect(hasGmailSetup()).toBe(true)
    expect(await isConnected()).toBe(true)
    expect(await connectedEmail()).toBe('me@college.edu')
  })

  it('reads mail with the native token, refreshing it once if Google rejects it', async () => {
    const auths: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>).Authorization
      auths.push(auth)
      if (url.includes('/messages?')) {
        return auth === 'Bearer old-token'
          ? new Response('{}', { status: 401 })
          : new Response(JSON.stringify({ messages: [{ id: 'm1' }] }), { status: 200 })
      }
      return new Response(JSON.stringify({
        id: 'm1', internalDate: String(Date.UTC(2026, 10, 20)),
        payload: { headers: [{ name: 'Subject', value: 'Lab file' }], mimeType: 'text/plain', body: { data: btoa('Submit lab file by 25/11') } },
      }), { status: 200 })
    }))
    const msgs = await fetchInbox(5, null)
    expect(msgs.map((m) => m.subject)).toEqual(['Lab file'])
    expect(auths).toEqual(['Bearer old-token', 'Bearer fresh-token', 'Bearer fresh-token'])
  })
})
