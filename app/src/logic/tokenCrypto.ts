// Best-effort at-rest protection for OAuth tokens.
// A web/PWA client cannot keep secrets truly safe (no server side), so we do
// the standard mitigation: derive a device-local key via PBKDF2 and encrypt
// tokens with AES-GCM before writing them to localStorage. Worst case an
// attacker with XSS still has access while the app runs — same as any SPA.

const KEY_SALT = 'at.token.salt.v1'; // holds the per-install random salt (plaintext)
const KEY_IV = 'at.token.iv.v1'; // iv used for the last encryption
const ENC_TOKENS = 'at.tokens.enc.v1'; // ciphertext blob

function b64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode('attendance-tracker-token-store-v1'),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: 150_000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function getSalt(): Uint8Array {
  let s = localStorage.getItem(KEY_SALT);
  if (!s) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    localStorage.setItem(KEY_SALT, b64(salt.buffer));
    return salt;
  }
  return fromB64(s);
}

export async function encryptJson(obj: unknown): Promise<void> {
  const salt = getSalt();
  const key = await deriveKey(salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    new TextEncoder().encode(JSON.stringify(obj)),
  );
  localStorage.setItem(KEY_IV, b64(iv.buffer));
  localStorage.setItem(ENC_TOKENS, b64(ct));
}

export async function decryptJson<T>(): Promise<T | null> {
  const ct = localStorage.getItem(ENC_TOKENS);
  const iv = localStorage.getItem(KEY_IV);
  if (!ct || !iv) return null;
  try {
    const key = await deriveKey(getSalt());
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(iv) as unknown as BufferSource },
      key,
      fromB64(ct) as unknown as BufferSource,
    );
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    return null; // corrupted or cleared -> treat as logged out
  }
}

export async function clearEncrypted(): Promise<void> {
  localStorage.removeItem(ENC_TOKENS);
  localStorage.removeItem(KEY_IV);
}
