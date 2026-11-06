import { useCallback, useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { pdfjs } from './documents';
import { mapPdfText, pdfSpeechRanges } from './pdfWords';
import { wordStart, type SpeechPart } from './speechPlan';
import type { Segment } from './types';
import type { ReaderMatch } from './readerView';

export interface PdfJump { key: string; segment?: number; y?: number; character?: number; center?: boolean }
export interface PdfRanges { speech: Range[]; search: Range[]; match: Range[] }
export type PdfDestination = (target: PdfJump) => { top: number; left: number; width: number; height: number } | undefined;
function mappedRanges(container: HTMLElement, mappings: WeakMap<HTMLElement, ReturnType<typeof mapPdfText>[number]>, parts: SpeechPart[]) {
  const ranges: Range[] = [];
  for (const element of container.querySelectorAll<HTMLElement>('span')) {
    const text = element.firstChild, positions = mappings.get(element);
    if (!positions || text?.nodeType !== Node.TEXT_NODE) continue;
    for (const part of pdfSpeechRanges(positions, parts)) {
      const range = new Range(); range.setStart(text, part.start); range.setEnd(text, part.end); ranges.push(range);
    }
  }
  return ranges;
}
interface Props {
  pdf: pdfjs.PDFDocumentProxy; pageNumber: number; segments: Segment[]; zoom: number; current: boolean;
  spokenParts?: SpeechPart[]; searchMatches: ReaderMatch[]; searchMatch?: ReaderMatch;
  onWord(index: number, character: number): void;
  onSize(page: number, ratio: number): void;
  onReady(page: number, destination?: PdfDestination): void;
  onRanges(page: number, ranges?: PdfRanges): void;
}
export default function PdfSheet({ pdf, pageNumber, segments, zoom, current, spokenParts, searchMatches, searchMatch, onWord, onSize, onReady, onRanges }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null), layerElement = useRef<HTMLDivElement>(null);
  const mappings = useRef(new WeakMap<HTMLElement, ReturnType<typeof mapPdfText>[number]>());
  const rendering = useRef<Promise<unknown>>(Promise.resolve());
  const viewportRef = useRef<ReturnType<pdfjs.PDFPageProxy['getViewport']> | undefined>(undefined);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const destination = useCallback<PdfDestination>(target => {
    const bounds = canvas.current?.getBoundingClientRect(), container = layerElement.current;
    if (!bounds) return;
    if (target.y !== undefined && viewportRef.current) {
      const viewport = viewportRef.current, point = viewport.convertToViewportPoint(0, target.y);
      return { top: bounds.top + Math.max(0, Math.min(1, point[1] / viewport.height)) * bounds.height, left: bounds.left, width: 0, height: 0 };
    }
    if (target.segment !== undefined && container) {
      for (const span of container.querySelectorAll<HTMLElement>('span')) {
        const positions = mappings.current.get(span), text = span.firstChild;
        const at = positions?.findIndex(position => position && position.index === target.segment && (target.character === undefined || position.character >= target.character));
        if (at === undefined || at < 0 || text?.nodeType !== Node.TEXT_NODE) continue;
        const range = new Range(); range.setStart(text, at); range.setEnd(text, Math.min(at + 1, text.textContent?.length || 0));
        return range.getBoundingClientRect();
      }
    }
    return bounds;
  }, []);
  useEffect(() => {
    if (loading) return;
    onReady(pageNumber, destination);
    return () => onReady(pageNumber);
  }, [loading, pageNumber, destination, onReady]);
  useEffect(() => {
    const container = layerElement.current;
    if (loading || !container) return;
    onRanges(pageNumber, {
      speech: mappedRanges(container, mappings.current, spokenParts || []),
      search: mappedRanges(container, mappings.current, searchMatches.filter(match => match.page === pageNumber).map(match => ({ ...match, offset: 0 }))),
      match: searchMatch?.page === pageNumber ? mappedRanges(container, mappings.current, [{ ...searchMatch, offset: 0 }]) : [],
    });
    return () => onRanges(pageNumber);
  }, [loading, pageNumber, spokenParts, searchMatches, searchMatch, onRanges]);
  useEffect(() => {
    let cancelled = false;
    let page: pdfjs.PDFPageProxy | undefined, renderTask: pdfjs.RenderTask | undefined;
    let layer: InstanceType<typeof pdfjs.TextLayer> | undefined, resizeObserver: ResizeObserver | undefined;
    setLoading(true); setError('');
    const previous = rendering.current, target = canvas.current, container = layerElement.current;
    const run = (async () => {
      try {
        await previous;
        if (cancelled || !target || !container) return;
        page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const viewport = page.getViewport({ scale: 1.5 * Math.max(1, zoom) }); viewportRef.current = viewport;
        onSize(pageNumber, viewport.width / viewport.height);
        target.width = viewport.width; target.height = viewport.height;
        renderTask = page.render({ canvas: target, viewport }); await renderTask.promise;
        if (cancelled) return;
        container.replaceChildren(); container.style.setProperty('--total-scale-factor', String(viewport.scale));
        const textContent = await page.getTextContent();
        if (cancelled) return;
        layer = new pdfjs.TextLayer({ textContentSource: textContent, container, viewport }); await layer.render();
        if (cancelled) return;
        container.style.width = `${viewport.width}px`; container.style.height = `${viewport.height}px`;
        const positions = mapPdfText(layer.textDivs.map(div => div.textContent || ''), segments, pageNumber, true);
        layer.textDivs.forEach((div, i) => { mappings.current.set(div, positions[i]); div.title = 'Click a word to listen from here'; });
        const resize = () => { container.style.transform = `scale(${target.clientWidth / viewport.width})`; };
        resize(); resizeObserver = new ResizeObserver(resize); resizeObserver.observe(target); setLoading(false);
      } catch (err) { if (!cancelled) { setError(err instanceof Error ? err.message : 'Could not render this page.'); setLoading(false); } }
      finally { if (cancelled) page?.cleanup(); }
    })();
    rendering.current = run;
    return () => {
      cancelled = true; renderTask?.cancel(); layer?.cancel(); resizeObserver?.disconnect();
      mappings.current = new WeakMap(); container?.replaceChildren();
      void run.finally(() => { page?.cleanup(); if (target) { target.width = 0; target.height = 0; } });
    };
  }, [pdf, pageNumber, segments, zoom, onSize]);
  return <div className="pdf-page" style={{ width: '100%', maxWidth: 'none' }}>{loading && <div className={current ? 'pdf-loading' : 'pdf-sheet-loading'}><LoaderCircle className="spin" /> Opening page {pageNumber}…</div>}{error && <p role="alert">{error}</p>}<canvas ref={canvas} aria-label={`Original PDF page ${pageNumber}`} /><div ref={layerElement} className="pdf-text-layer" aria-label={`Selectable PDF text, page ${pageNumber}`} onClick={event => {
    if (window.getSelection()?.toString()) return;
    const caret = (document as Document & { caretRangeFromPoint(x: number, y: number): Range | null }).caretRangeFromPoint(event.clientX, event.clientY), element = caret?.startContainer.parentElement;
    if (!caret || !element || !layerElement.current?.contains(element)) return;
    const map = mappings.current.get(element), position = map?.[Math.min(caret.startOffset, map.length - 1)];
    if (position) { if (event.detail > 0) (document.activeElement as HTMLElement)?.blur(); onWord(position.index, wordStart(segments[position.index].text, position.character)); }
  }} /></div>;
}
