// Full-screen in-app viewer for Locker PDFs and images.
// • PDFs are drawn with pdf.js (already bundled for timetable import), page
//   by page as they scroll into view, so big files open quickly.
// • Pinch or the − / + buttons zoom (the app disables browser zoom). Pages
//   are scaled with CSS while pinching, then redrawn sharp once you stop.
// • The phone's Back button closes the viewer (a history entry is pushed).

import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Minus, Plus, X } from 'lucide-react'
import type { PDFDocumentProxy } from 'pdfjs-dist'

const MIN_ZOOM = 1
const MAX_ZOOM = 4

async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist')
  // @ts-ignore -- vite-only "?url" import suffix
  const workerMod = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url' as string)) as unknown as { default?: string }
  pdfjs.GlobalWorkerOptions.workerSrc = workerMod.default ?? ''
  return pdfjs
}

export default function FileViewer({
  blob,
  name,
  kind,
  onClose,
  onOpenWith,
}: {
  blob: Blob
  name: string
  kind: 'pdf' | 'image'
  onClose: () => void
  onOpenWith: () => void
}) {
  const [zoom, setZoom] = useState(1)
  const [settledZoom, setSettledZoom] = useState(1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pinch = useRef<{ dist: number; zoom: number } | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  // Back button closes the viewer instead of leaving the screen.
  useEffect(() => {
    history.pushState({ fileViewer: true }, '')
    const onPop = () => closeRef.current()
    window.addEventListener('popstate', onPop)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && history.back()
    window.addEventListener('keydown', onKey)
    document.body.classList.add('viewer-open')
    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('keydown', onKey)
      document.body.classList.remove('viewer-open')
    }
  }, [])

  // Redraw sharp only after zooming stops.
  useEffect(() => {
    const t = setTimeout(() => setSettledZoom(zoom), 250)
    return () => clearTimeout(t)
  }, [zoom])

  const clamp = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100))
  const dist = (t: React.TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)

  return (
    <div className="viewer" role="dialog" aria-label={name}>
      <div className="viewer-bar">
        <button className="icon-btn small light" onClick={() => history.back()} aria-label="Close">
          <X size={20} />
        </button>
        <span className="viewer-name">{name}</span>
        <button className="icon-btn small light" onClick={() => setZoom((z) => clamp(z - 0.5))} disabled={zoom <= MIN_ZOOM} aria-label="Zoom out">
          <Minus size={18} />
        </button>
        <span className="viewer-zoom">{Math.round(zoom * 100)}%</span>
        <button className="icon-btn small light" onClick={() => setZoom((z) => clamp(z + 0.5))} disabled={zoom >= MAX_ZOOM} aria-label="Zoom in">
          <Plus size={18} />
        </button>
        <button className="icon-btn small light" onClick={onOpenWith} aria-label="Open with another app">
          <ExternalLink size={18} />
        </button>
      </div>
      <div
        className="viewer-scroll"
        ref={scrollRef}
        onTouchStart={(e) => {
          if (e.touches.length === 2) pinch.current = { dist: dist(e.touches), zoom }
        }}
        onTouchMove={(e) => {
          // (browser zoom is disabled app-wide, so no preventDefault needed)
          if (e.touches.length === 2 && pinch.current) {
            setZoom(clamp(pinch.current.zoom * (dist(e.touches) / pinch.current.dist)))
          }
        }}
        onTouchEnd={() => {
          pinch.current = null
        }}
      >
        {kind === 'pdf' ? (
          <PdfPages blob={blob} zoom={zoom} renderZoom={settledZoom} scrollRef={scrollRef} />
        ) : (
          <ImageView blob={blob} name={name} zoom={zoom} />
        )}
      </div>
    </div>
  )
}

function ImageView({ blob, name, zoom }: { blob: Blob; name: string; zoom: number }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  if (!url) return null
  return <img className="viewer-image" src={url} alt={name} style={{ width: `${zoom * 100}%` }} />
}

function PdfPages({
  blob,
  zoom,
  renderZoom,
  scrollRef,
}: {
  blob: Blob
  zoom: number
  renderZoom: number
  scrollRef: React.RefObject<HTMLDivElement>
}) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [ratios, setRatios] = useState<number[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let loaded: PDFDocumentProxy | null = null
    ;(async () => {
      try {
        const pdfjs = await loadPdfjs()
        const d = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise
        loaded = d
        if (cancelled) return
        // page height ÷ width, so placeholders keep their size before drawing
        const r: number[] = []
        for (let i = 1; i <= d.numPages; i++) {
          const vp = (await d.getPage(i)).getViewport({ scale: 1 })
          r.push(vp.height / vp.width)
        }
        if (cancelled) return
        setDoc(d)
        setRatios(r)
      } catch (err) {
        if (!cancelled) setError(/password/i.test(String(err)) ? 'This PDF is password-protected — open it with another app.' : 'This PDF could not be opened — try opening it with another app.')
      }
    })()
    return () => {
      cancelled = true
      void loaded?.destroy()
    }
  }, [blob])

  if (error) return <div className="viewer-msg">{error}</div>
  if (!doc) return <div className="viewer-msg">Opening…</div>
  return (
    <div className="viewer-pages" style={{ width: `${zoom * 100}%` }}>
      {ratios.map((ratio, i) => (
        <PdfPage key={i} doc={doc} pageNo={i + 1} ratio={ratio} renderZoom={renderZoom} scrollRef={scrollRef} />
      ))}
      <div className="viewer-msg small">{ratios.length} page{ratios.length === 1 ? '' : 's'}</div>
    </div>
  )
}

function PdfPage({
  doc,
  pageNo,
  ratio,
  renderZoom,
  scrollRef,
}: {
  doc: PDFDocumentProxy
  pageNo: number
  ratio: number
  renderZoom: number
  scrollRef: React.RefObject<HTMLDivElement>
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(pageNo <= 2)

  useEffect(() => {
    const el = boxRef.current
    if (!el || visible) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true)
          io.disconnect()
        }
      },
      { root: scrollRef.current, rootMargin: '600px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [visible, scrollRef])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    let task: { cancel: () => void; promise: Promise<void> } | null = null
    ;(async () => {
      const page = await doc.getPage(pageNo)
      const box = boxRef.current
      const canvas = canvasRef.current
      if (cancelled || !box || !canvas) return
      const cssWidth = box.clientWidth || 360
      const dpr = Math.min(window.devicePixelRatio || 1, 3)
      const base = page.getViewport({ scale: 1 })
      // cap the bitmap so very high zoom on big pages can't exhaust memory
      const scale = Math.min((cssWidth * dpr) / base.width, 4096 / base.width)
      const vp = page.getViewport({ scale })
      const off = document.createElement('canvas')
      off.width = Math.floor(vp.width)
      off.height = Math.floor(vp.height)
      const ctx = off.getContext('2d')
      if (!ctx) return
      task = page.render({ canvasContext: ctx, viewport: vp }) as unknown as { cancel: () => void; promise: Promise<void> }
      try {
        await task.promise
      } catch {
        return // cancelled by a newer render
      }
      if (cancelled) return
      canvas.width = off.width
      canvas.height = off.height
      canvas.getContext('2d')?.drawImage(off, 0, 0)
    })()
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [visible, doc, pageNo, renderZoom])

  return (
    <div className="viewer-page" ref={boxRef} style={{ aspectRatio: `1 / ${ratio}` }}>
      <canvas ref={canvasRef} aria-label={`Page ${pageNo}`} />
    </div>
  )
}
