// Locker file contents, kept in IndexedDB.
// The app's main data lives in localStorage, which only holds ~5 MB — far too
// small for PDFs and photos. File CONTENTS go here instead (works in the
// browser and in the Android WebView with no plugin); the file's name, size
// and subject are kept in the normal app data (AppData.files) so lists,
// counts and search stay synchronous.

const DB_NAME = 'attendancetracker-files'
const STORE = 'files'

/** Largest single file the Locker accepts. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024

let dbPromise: Promise<IDBDatabase> | null = null

function db(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('File storage is not available on this device.'))
      return
    }
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Could not open file storage.'))
  })
  dbPromise.catch(() => {
    dbPromise = null // allow a retry later
  })
  return dbPromise
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return db().then(
    (d) =>
      new Promise<T | undefined>((resolve, reject) => {
        const tx = d.transaction(STORE, mode)
        const req = fn(tx.objectStore(STORE))
        tx.oncomplete = () => resolve(req ? req.result : undefined)
        tx.onerror = () => reject(tx.error ?? new Error('File storage error.'))
        tx.onabort = () =>
          reject(
            tx.error?.name === 'QuotaExceededError'
              ? new Error('Your phone is out of space for Locker files. Delete some files and try again.')
              : (tx.error ?? new Error('File storage error.')),
          )
      }),
  )
}

export async function putFileBlob(id: string, blob: Blob): Promise<void> {
  await run('readwrite', (s) => s.put(blob, id))
  // Ask the browser not to clear Locker files under storage pressure (best effort).
  try {
    await navigator.storage?.persist?.()
  } catch {
    /* not supported */
  }
}

export async function getFileBlob(id: string): Promise<Blob | null> {
  const b = await run<Blob>('readonly', (s) => s.get(id))
  return b instanceof Blob ? b : null
}

export async function deleteFileBlobs(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await run('readwrite', (s) => {
    for (const id of ids) s.delete(id)
  })
}

export async function clearFileBlobs(): Promise<void> {
  await run('readwrite', (s) => s.clear())
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

/** What the Locker can show by itself. */
export function viewerKind(type: string, name: string): 'pdf' | 'image' | null {
  const t = type.toLowerCase()
  const n = name.toLowerCase()
  if (t === 'application/pdf' || n.endsWith('.pdf')) return 'pdf'
  if (/^image\/(png|jpe?g|gif|webp|bmp|svg\+xml)$/.test(t) || /\.(png|jpe?g|gif|webp|bmp)$/.test(n)) return 'image'
  return null
}

/** Best-effort MIME type when the picker didn't give one (common on Android). */
export function guessType(name: string, given: string): string {
  if (given) return given
  const ext = name.toLowerCase().split('.').pop() ?? ''
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    txt: 'text/plain', csv: 'text/csv', zip: 'application/zip',
  }
  return map[ext] ?? 'application/octet-stream'
}
