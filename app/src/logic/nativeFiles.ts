// Hand a file to the rest of the phone: "Open with…" another app, Share, or
// save a download. The Android WebView can't follow blob: links, so on native
// the file is first written to the app's cache folder (exposed through the
// FileProvider) and then opened / shared from there. On the web the browser
// does the job itself.

import { Capacitor } from '@capacitor/core'

const isNative = () => Capacitor.isNativePlatform()

/** File names safe for the cache folder (keeps the extension). */
function safeName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim()
  return cleaned || 'file'
}

/** Blob bytes; FileReader fallback for older WebViews without Blob.arrayBuffer(). */
function readBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as ArrayBuffer)
    r.onerror = () => reject(r.error ?? new Error('Could not read the file.'))
    r.readAsArrayBuffer(blob)
  })
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await readBytes(blob))
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < buf.length; i += CHUNK) bin += String.fromCharCode(...buf.subarray(i, i + CHUNK))
  return btoa(bin)
}

/** Write to the app cache and return a file:// URI other apps can be given. */
async function writeToCache(blob: Blob, name: string): Promise<string> {
  const { Filesystem, Directory } = await import('@capacitor/filesystem')
  const res = await Filesystem.writeFile({
    path: `shared/${Date.now()}_${safeName(name)}`,
    data: await blobToBase64(blob),
    directory: Directory.Cache,
    recursive: true,
  })
  return res.uri
}

function downloadInBrowser(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** Open the file in another app ("Open with…" chooser on Android). */
export async function openWithOtherApp(blob: Blob, name: string, type: string): Promise<void> {
  if (isNative()) {
    const uri = await writeToCache(blob, name)
    const { FileOpener } = await import('@capacitor-community/file-opener')
    try {
      await FileOpener.open({ filePath: uri, contentType: type || 'application/octet-stream', openWithDefault: false })
    } catch {
      throw new Error('No app on this phone can open this kind of file.')
    }
    return
  }
  // Web: PDFs/images/text open in a new tab; everything else downloads.
  if (/^(application\/pdf|image\/|text\/)/.test(type)) {
    const url = URL.createObjectURL(blob)
    const w = window.open(url, '_blank', 'noopener')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    if (w) return
  }
  downloadInBrowser(blob, name)
}

/** Share the file (WhatsApp, Drive, email…). Falls back to a download. */
export async function shareFile(blob: Blob, name: string, type: string): Promise<void> {
  if (isNative()) {
    const uri = await writeToCache(blob, name)
    const { Share } = await import('@capacitor/share')
    try {
      await Share.share({ title: name, files: [uri], dialogTitle: `Share ${name}` })
    } catch (err) {
      // closing the share sheet without picking an app is not an error
      if (!/cancel/i.test(String(err))) throw err
    }
    return
  }
  const file = new File([blob], name, { type })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name })
      return
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return
    }
  }
  downloadInBrowser(blob, name)
}

/** Save a generated file (e.g. the data export). On Android the WebView
 *  ignores download links, so the share sheet is used — pick Drive, Files,
 *  WhatsApp, email… to keep the copy. */
export async function saveGeneratedFile(blob: Blob, name: string, type: string): Promise<void> {
  if (isNative()) return shareFile(blob, name, type)
  downloadInBrowser(blob, name)
}
