'use client';
import { useEffect, useRef, useState } from 'react';

type Labels = { show: string; exit: string; prev: string; next: string; page: string };

// Renders a PDF page by page onto a canvas: no download button, no browser
// PDF toolbar. Each page carries a small LanHub footer with the viewer's code.
export default function PdfViewer({ url, footer, labels }: { url: string; footer: string; labels: Labels }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
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
        const loaded = await pdfjs.getDocument({ url }).promise;
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
      const width = Math.min(wrap.current?.clientWidth ?? 800, full ? window.innerWidth : 900);
      const base = p.getViewport({ scale: 1 });
      const scale = (width / base.width) * (window.devicePixelRatio || 1);
      const viewport = p.getViewport({ scale });
      const c = canvas.current!;
      c.width = viewport.width;
      c.height = viewport.height;
      c.style.width = `${width}px`;
      const render = p.render({ canvas: c, canvasContext: c.getContext('2d')!, viewport });
      task = render;
      await render.promise.catch(() => {});
    })();
    return () => task?.cancel();
  }, [doc, page, full]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!doc) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') setPage((n) => Math.min(doc.numPages, n + 1));
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') setPage((n) => Math.max(1, n - 1));
    };
    const onFs = () => setFull(Boolean(document.fullscreenElement));
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFs);
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('fullscreenchange', onFs); };
  }, [doc]);

  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else wrap.current?.requestFullscreen();
  };

  if (error) return <div className="flash">{error}</div>;
  const total = doc?.numPages ?? 0;

  return (
    <div className="stack">
      <div className="row">
        <button type="button" onClick={() => setPage((n) => Math.max(1, n - 1))} disabled={page <= 1}>{labels.prev}</button>
        <span className="muted">{labels.page.replace('{n}', String(page)).replace('{total}', String(total || '…'))}</span>
        <button type="button" onClick={() => setPage((n) => Math.min(total, n + 1))} disabled={!total || page >= total}>{labels.next}</button>
        <button type="button" className="primary" onClick={toggleFull}>{full ? labels.exit : labels.show}</button>
      </div>
      <div
        ref={wrap}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          background: full ? '#2a2422' : 'transparent', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', userSelect: 'none', overflow: 'auto',
        }}
      >
        <div style={{ position: 'relative', background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,.15)' }}>
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
