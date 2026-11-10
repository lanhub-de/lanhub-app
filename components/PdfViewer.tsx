'use client';
import { useEffect, useRef, useState } from 'react';

type Labels = {
  show: string; exit: string; prev: string; next: string; page: string;
  fitPage?: string; fitWidth?: string; zoomIn?: string; zoomOut?: string;
};

// Renders a PDF page by page onto a canvas: no download button, no browser
// PDF toolbar. Each page carries a small LanHub footer with the viewer's code.
// By default the whole page fits the screen (handy for a screenshot for notes);
// "fit width" and zoom are a click away, and the toolbar stays on top.
export default function PdfViewer({ url, footer, labels }: { url: string; footer: string; labels: Labels }) {
  const wrap = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [fit, setFit] = useState<'page' | 'width'>('page');
  const [zoom, setZoom] = useState(1);
  const [resized, setResized] = useState(0);
  const scrolled = useRef(false);
  const [doc, setDoc] = useState<import('pdfjs-dist').PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [full, setFull] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        // Only the pages turned to are fetched (range requests), not the whole
        // book: big textbooks open fast and use little traffic.
        const loaded = await pdfjs.getDocument({ url, disableAutoFetch: true, disableStream: true, rangeChunkSize: 256 * 1024 }).promise;
        if (!cancelled) setDoc(loaded);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  useEffect(() => {
    if (!doc || !canvas.current) return;
    let task: { cancel: () => void } | null = null;
    (async () => {
      const p = await doc.getPage(page);
      const base = p.getViewport({ scale: 1 });
      const barH = full ? 0 : (bar.current?.offsetHeight ?? 52) + 16;
      const availW = full ? window.innerWidth : (wrap.current?.clientWidth ?? 800);
      const availH = (full ? window.innerHeight : window.innerHeight - barH) - 8;
      const byWidth = availW / base.width;
      const css = (fit === 'page' && !(full && zoom !== 1) ? Math.min(byWidth, availH / base.height) : byWidth) * zoom;
      const viewport = p.getViewport({ scale: css * (window.devicePixelRatio || 1) });
      const c = canvas.current!;
      c.width = viewport.width;
      c.height = viewport.height;
      c.style.width = `${Math.round(base.width * css)}px`;
      c.style.height = `${Math.round(base.height * css)}px`;
      const render = p.render({ canvas: c, canvasContext: c.getContext('2d')!, viewport });
      task = render;
      await render.promise.catch(() => {});
      // the first time, bring the toolbar to the top so the whole page is on screen
      if (!scrolled.current && !full && fit === 'page' && bar.current) {
        scrolled.current = true;
        const top = bar.current.getBoundingClientRect().top + window.scrollY;
        if (top > 40) window.scrollTo({ top: top - 8, behavior: 'smooth' });
      }
    })();
    return () => task?.cancel();
  }, [doc, page, full, fit, zoom, resized]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!doc) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') setPage((n) => Math.min(doc.numPages, n + 1));
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') setPage((n) => Math.max(1, n - 1));
    };
    const onFs = () => setFull(Boolean(document.fullscreenElement));
    let t: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => { clearTimeout(t); t = setTimeout(() => setResized((n) => n + 1), 150); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('fullscreenchange', onFs);
    };
  }, [doc]);

  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else wrap.current?.requestFullscreen();
  };

  if (error) return <div className="flash">{error}</div>;
  const total = doc?.numPages ?? 0;

  return (
    <div className="stack">
      <div className="row pdf-bar" ref={bar}>
        <button type="button" onClick={() => setPage((n) => Math.max(1, n - 1))} disabled={page <= 1}>{labels.prev}</button>
        <span className="muted">{labels.page.replace('{n}', String(page)).replace('{total}', String(total || '…'))}</span>
        <button type="button" onClick={() => setPage((n) => Math.min(total, n + 1))} disabled={!total || page >= total}>{labels.next}</button>
        <span className="pdf-zoom">
          <button type="button" className={fit === 'page' && zoom === 1 ? 'on' : ''} onClick={() => { setFit('page'); setZoom(1); }}>
            {labels.fitPage ?? 'Whole page'}
          </button>
          <button type="button" className={fit === 'width' && zoom === 1 ? 'on' : ''} onClick={() => { setFit('width'); setZoom(1); }}>
            {labels.fitWidth ?? 'Fit width'}
          </button>
          <button type="button" aria-label={labels.zoomOut ?? 'Zoom out'} title={labels.zoomOut ?? 'Zoom out'}
            onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} disabled={zoom <= 0.5}>−</button>
          <button type="button" aria-label={labels.zoomIn ?? 'Zoom in'} title={labels.zoomIn ?? 'Zoom in'}
            onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))} disabled={zoom >= 3}>+</button>
        </span>
        <button type="button" className="primary" onClick={toggleFull}>{full ? labels.exit : labels.show}</button>
      </div>
      <div
        ref={wrap}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          background: full ? '#2a2422' : 'transparent', display: 'flex', flexDirection: 'column',
          alignItems: fit === 'width' || zoom > 1 ? 'flex-start' : 'center', justifyContent: 'center', userSelect: 'none', overflow: 'auto',
        }}
      >
        <div
          style={{ position: 'relative', background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,.15)', flex: 'none' }}
          onClick={(e) => {
            if (!full || !total) return;
            const r = e.currentTarget.getBoundingClientRect();
            setPage((n) => (e.clientX - r.left > r.width / 2 ? Math.min(total, n + 1) : Math.max(1, n - 1)));
          }}
        >
          <canvas ref={canvas} aria-label="page" />
          <div style={{
            position: 'absolute', left: 0, right: 0, bottom: 6, display: 'flex', justifyContent: 'space-between',
            padding: '0 18px', fontSize: 11, color: '#8a7f77', pointerEvents: 'none',
          }}>
            <span style={{ fontWeight: 700, color: '#a30000' }}>LanHub</span>
            <span>{footer.replace(/^LanHub · ?/, '')} · {page}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
