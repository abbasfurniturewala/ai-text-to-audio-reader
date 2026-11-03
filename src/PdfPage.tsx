import { useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { pdfjs } from './documents';
import { loadPdfBytes } from './library';
import { mapPdfText } from './pdfWords';
import type { Segment } from './types';
export default function PdfPage({ documentId, pageNumber, segments, onWord, jumpTarget }: { documentId: string; pageNumber: number; segments: Segment[]; onWord(index: number, character: number): void; jumpTarget?: { key: string; segment?: number; y?: number } }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const layerElement = useRef<HTMLDivElement>(null);
  const mappings = useRef(new WeakMap<HTMLElement, ReturnType<typeof mapPdfText>[number]>());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [opened, setOpened] = useState<{ id: string; pdf: pdfjs.PDFDocumentProxy }>();
  const rendering = useRef<Promise<unknown>>(Promise.resolve());
  const pageViewport = useRef<ReturnType<pdfjs.PDFPageProxy['getViewport']> | undefined>(undefined);
  useEffect(() => {
    if (loading || !jumpTarget || jumpTarget.key !== `page-${pageNumber}` || !canvas.current) return;
    if (jumpTarget.y === undefined && jumpTarget.segment === undefined) return;
    const scroller = canvas.current.closest('.reader-scroll');
    if (!scroller) return;
    const bounds = canvas.current.getBoundingClientRect();
    let top = bounds.top;
    if (jumpTarget.y !== undefined && pageViewport.current) {
      const viewport = pageViewport.current;
      const point = viewport.convertToViewportPoint(0, jumpTarget.y);
      top += Math.max(0, Math.min(1, point[1] / viewport.height)) * bounds.height;
    } else if (jumpTarget.segment !== undefined) {
      const heading = Array.from(layerElement.current?.querySelectorAll<HTMLElement>('span') || []).find(element => mappings.current.get(element)?.some(position => position?.index === jumpTarget.segment));
      if (heading) top = heading.getBoundingClientRect().top;
    }
    scroller.scrollTo({ top: scroller.scrollTop + top - scroller.getBoundingClientRect().top - 18, behavior: 'instant' });
  }, [loading, jumpTarget, pageNumber]);
  useEffect(() => {
    let cancelled = false;
    let task: pdfjs.PDFDocumentLoadingTask | undefined;
    setOpened(undefined); setLoading(true); setError('');
    void loadPdfBytes(documentId).then(async bytes => {
      if (cancelled) return;
      // This buffer belongs to this viewer only; PDF.js can transfer it without
      // keeping a second full copy of the book in React or the shelf.
      task = pdfjs.getDocument({ data: bytes });
      const pdf = await task.promise;
      if (!cancelled) setOpened({ id: documentId, pdf });
    }).catch(err => { if (!cancelled) { setError(err.message); setLoading(false); } });
    return () => { cancelled = true; void task?.destroy(); };
  }, [documentId]);
  useEffect(() => {
    if (!opened || opened.id !== documentId) return;
    let cancelled = false;
    let page: pdfjs.PDFPageProxy | undefined;
    let renderTask: pdfjs.RenderTask | undefined;
    let layer: InstanceType<typeof pdfjs.TextLayer> | undefined;
    let resizeObserver: ResizeObserver | undefined;
    setLoading(true); setError('');
    const previous = rendering.current;
    const target = canvas.current;
    const container = layerElement.current;
    const run = (async () => {
      try {
        await previous;
        if (cancelled || !target || !container) return;
        page = await opened.pdf.getPage(pageNumber);
        if (cancelled) return;
        const viewport = page.getViewport({ scale: 1.5 });
        pageViewport.current = viewport;
        target.width = viewport.width; target.height = viewport.height;
        renderTask = page.render({ canvas: target, viewport });
        await renderTask.promise;
        if (cancelled) return;
        container.replaceChildren();
        container.style.setProperty('--total-scale-factor', String(viewport.scale));
        container.style.width = `${viewport.width}px`;
        container.style.height = `${viewport.height}px`;
        const textContent = await page.getTextContent();
        if (cancelled) return;
        layer = new pdfjs.TextLayer({ textContentSource: textContent, container, viewport });
        await layer.render();
        if (cancelled) return;
        // TextLayer replaces its dimensions with CSS round() expressions.
        // Keep an explicit viewport size before scaling to the fitted canvas.
        container.style.width = `${viewport.width}px`;
        container.style.height = `${viewport.height}px`;
        const positions = mapPdfText(layer.textDivs.map(div => div.textContent || ''), segments, pageNumber);
        layer.textDivs.forEach((div, i) => { mappings.current.set(div, positions[i]); div.title = 'Click a word to listen from here'; });
        const resize = () => { container.style.transform = `scale(${target.clientWidth / viewport.width})`; };
        resize();
        const observer = new ResizeObserver(resize); observer.observe(target);
        if (cancelled) observer.disconnect(); else resizeObserver = observer;
        if (!cancelled) setLoading(false);
      } catch (err) { if (!cancelled) { setError(err instanceof Error ? err.message : 'Could not render this page.'); setLoading(false); } }
      finally { if (cancelled) page?.cleanup(); }
    })();
    rendering.current = run;
    return () => {
      cancelled = true; renderTask?.cancel(); layer?.cancel(); resizeObserver?.disconnect();
      mappings.current = new WeakMap(); container?.replaceChildren();
      // Wait for any canvas operation to end before releasing its backing store.
      void run.finally(() => { page?.cleanup(); if (target) { target.width = 0; target.height = 0; } });
    };
  }, [opened, documentId, pageNumber, segments]);
  return <div className="pdf-page">{loading && <div className="pdf-loading"><LoaderCircle className="spin" /> Opening page…</div>}{error && <p role="alert">{error}</p>}<canvas ref={canvas} aria-label={`Original PDF page ${pageNumber}`} /><div ref={layerElement} className="pdf-text-layer" aria-label="Selectable PDF text" onClick={event => {
    if (window.getSelection()?.toString()) return;
    const caret = (document as Document & { caretRangeFromPoint(x: number, y: number): Range | null }).caretRangeFromPoint(event.clientX, event.clientY);
    const element = caret?.startContainer.parentElement;
    if (!caret || !element || !layerElement.current?.contains(element)) return;
    const map = mappings.current.get(element);
    const position = map?.[Math.min(caret.startOffset, map.length - 1)];
    if (position) onWord(position.index, position.character);
  }} /></div>;
}
