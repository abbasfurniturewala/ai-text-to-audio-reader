import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { pdfjs } from './documents';
import { loadPdfBytes } from './library';
import PdfSheet, { type PdfDestination, type PdfJump, type PdfRanges } from './PdfSheet';
import type { SpeechPart } from './speechPlan';
import type { Segment } from './types';
import type { ReaderMatch } from './readerView';
export type { PdfJump } from './PdfSheet';

interface Props {
  documentId: string; pageNumber: number; segments: Segment[]; zoom?: number;
  jumpTarget?: PdfJump; spokenParts?: SpeechPart[]; searchMatches?: ReaderMatch[]; searchMatch?: ReaderMatch;
  onWord(index: number, character: number): void; onPage(page: number): void;
}
export default memo(function PdfPage(props: Props) {
  const { documentId, pageNumber, segments, onWord, jumpTarget, spokenParts, zoom = 1, searchMatches = [], searchMatch } = props;
  const root = useRef<HTMLDivElement>(null), slots = useRef<Array<HTMLDivElement | null>>([]);
  const handles = useRef(new Map<number, PdfDestination>()), ranges = useRef(new Map<number, PdfRanges>());
  const pending = useRef<{ page: number; target: PdfJump } | undefined>(undefined);
  const pinned = useRef<{ page: number; top: number } | undefined>(undefined);
  const anchor = useRef<{ page: number; fraction: number } | undefined>(undefined);
  const [opened, setOpened] = useState<{ id: string; pdf: pdfjs.PDFDocumentProxy; ratio: number }>();
  const [error, setError] = useState(''), [sizes, setSizes] = useState<Record<number, number>>({});
  const [windowPages, setWindowPages] = useState({ first: Math.max(1, pageNumber - 1), last: pageNumber + 2 });
  const latest = useRef(props); latest.current = props;
  const refresh = useRef<() => void>(() => {});
  const publish = useCallback((page: number) => { if (root.current) root.current.dataset.page = String(page); latest.current.onPage(page); }, []);
  const position = useCallback(() => {
    const jump = pending.current, scroller = root.current?.closest('.reader-scroll'), slot = jump && slots.current[jump.page];
    if (!jump || !slot || !scroller) return;
    const destination = handles.current.get(jump.page)?.(jump.target);
    const bounds = destination || slot.getBoundingClientRect(), viewport = scroller.getBoundingClientRect();
    const toolbar = scroller.querySelector<HTMLElement>('.pdf-pagination');
    const inset = toolbar?.getBoundingClientRect().height ? toolbar.getBoundingClientRect().height + (parseFloat(getComputedStyle(scroller).paddingTop) || 0) + 12 : 18;
    const gap = jump.target.center && destination ? Math.max(inset, (scroller.clientHeight - bounds.height) / 2) : inset + (jump.target.y !== undefined ? 24 : 0);
    const left = destination && (bounds.left < viewport.left + 18 || bounds.left + bounds.width > viewport.right - 18) ? scroller.scrollLeft + bounds.left - viewport.left - 18 : scroller.scrollLeft;
    scroller.scrollTo({ top: scroller.scrollTop + bounds.top - viewport.top - gap, left, behavior: 'instant' });
    publish(jump.page);
    if (destination) { pending.current = undefined; pinned.current = { page: jump.page, top: scroller.scrollTop }; }
  }, [publish]);
  const ready = useCallback((page: number, destination?: PdfDestination) => {
    if (destination) handles.current.set(page, destination); else handles.current.delete(page);
    if (pending.current?.page === page && destination) position();
  }, [position]);
  const updateRanges = useCallback((page: number, value?: PdfRanges) => {
    if (value) ranges.current.set(page, value); else ranges.current.delete(page);
    for (const [kind, name, priority] of [['speech','cadence-pdf-speech',3], ['search','cadence-pdf-search',1], ['match','cadence-pdf-match',2]] as const) {
      const parts = [...ranges.current].sort(([a],[b]) => a - b).flatMap(([,value]) => value[kind]);
      if (!parts.length) CSS.highlights.delete(name);
      else { const highlight = new Highlight(...parts); highlight.priority = priority; CSS.highlights.set(name, highlight); }
    }
  }, []);
  const measure = useCallback((page: number, ratio: number) => {
    setSizes(previous => {
      if (Math.abs((previous[page] ?? opened?.ratio ?? ratio) - ratio) < 1e-7) return previous;
      const scroller = root.current?.closest('.reader-scroll'), current = Number(root.current?.dataset.page), slot = slots.current[current];
      if (scroller && slot && !pending.current) { const box = slot.getBoundingClientRect(); anchor.current = { page: current, fraction: (scroller.getBoundingClientRect().top + 30 - box.top) / box.height }; }
      return { ...previous, [page]: ratio };
    });
  }, [opened?.ratio]);
  useEffect(() => {
    let cancelled = false, task: pdfjs.PDFDocumentLoadingTask | undefined;
    setOpened(undefined); setError(''); setSizes({}); handles.current.clear();
    void loadPdfBytes(documentId).then(async bytes => {
      if (cancelled) return;
      task = pdfjs.getDocument({ data: bytes }); const pdf = await task.promise;
      const first = await pdf.getPage(1), viewport = first.getViewport({ scale: 1 });
      if (!cancelled) setOpened({ id: documentId, pdf, ratio: viewport.width / viewport.height });
    }).catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; void task?.destroy(); };
  }, [documentId]);
  useEffect(() => () => { ranges.current.clear(); for (const name of ['cadence-pdf-speech','cadence-pdf-search','cadence-pdf-match']) CSS.highlights.delete(name); }, []);
  useLayoutEffect(() => {
    if (!opened || opened.id !== documentId) return;
    const target = jumpTarget || { key: `page-${pageNumber}` }, number = Number(target.key.replace('page-', ''));
    if (!Number.isInteger(number) || number < 1 || number > opened.pdf.numPages) return;
    pending.current = { page: number, target }; pinned.current = undefined;
    setWindowPages({ first: Math.max(1, number - 1), last: Math.min(opened.pdf.numPages, number + 2) }); position();
  }, [jumpTarget, opened, documentId, position]);
  useLayoutEffect(() => {
    const point = anchor.current, scroller = root.current?.closest('.reader-scroll'); anchor.current = undefined;
    if (point && scroller && !pending.current) {
      const slot = slots.current[point.page];
      if (slot) { const box = slot.getBoundingClientRect(), top = scroller.scrollTop + box.top + box.height * point.fraction - scroller.getBoundingClientRect().top - 30; if (Math.abs(top - scroller.scrollTop) > .5) scroller.scrollTo({ top, behavior: 'instant' }); }
    }
    position(); refresh.current();
  }, [sizes, windowPages, zoom, position]);
  useEffect(() => {
    const container = root.current, scroller = container?.closest('.reader-scroll');
    if (!container || !scroller || !opened) return;
    let frame = 0;
    const at = (y: number) => {
      let low = 1, high = opened.pdf.numPages;
      while (low < high) { const mid = Math.ceil((low + high) / 2), slot = slots.current[mid]; if (slot && slot.getBoundingClientRect().top <= y) low = mid; else high = mid - 1; }
      return low;
    };
    const update = () => {
      frame = 0; const viewport = scroller.getBoundingClientRect();
      if (pending.current) { position(); return; }
      const page = pinned.current && Math.abs(scroller.scrollTop - pinned.current.top) < 2 ? pinned.current.page : at(viewport.top + scroller.clientHeight / 2);
      if (pinned.current?.page !== page) pinned.current = undefined;
      publish(page);
      let first = at(viewport.top - 600), last = Math.min(opened.pdf.numPages, at(viewport.bottom + 600) + 1);
      if (last - first >= 8) { first = Math.max(1, page - 3); last = Math.min(opened.pdf.numPages, first + 7); }
      setWindowPages(previous => previous.first === first && previous.last === last ? previous : { first, last });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const cancel = () => { pending.current = undefined; pinned.current = undefined; schedule(); };
    refresh.current = schedule; scroller.addEventListener('scroll', schedule, { passive: true });
    const events = ['wheel','pointerdown','keydown','touchstart'] as const;
    events.forEach(name => scroller.addEventListener(name, cancel, { passive: true }));
    const observer = new ResizeObserver(schedule); observer.observe(scroller); observer.observe(container); schedule();
    return () => { cancelAnimationFrame(frame); refresh.current = () => {}; observer.disconnect(); scroller.removeEventListener('scroll', schedule); events.forEach(name => scroller.removeEventListener(name, cancel)); };
  }, [opened, position, publish]);
  return <div className="pdf-document" ref={root} data-page={pageNumber} aria-label="Continuous PDF document">{error ? <p role="alert">{error}</p> : !opened || opened.id !== documentId ? <div className="pdf-loading"><LoaderCircle className="spin" /> Opening document…</div> : Array.from({ length: opened.pdf.numPages }, (_, index) => {
    const page = index + 1, mounted = page >= windowPages.first && page <= windowPages.last;
    return <div key={page} ref={element => { slots.current[page] = element; }} className="pdf-page-slot" data-pdf-page={page} data-current={page === pageNumber} data-mounted={mounted} style={{ width: `calc(min(100%, var(--pdf-fit-width, 900px)) * ${zoom})`, aspectRatio: sizes[page] || opened.ratio }} aria-label={`PDF page ${page}`}>
      {mounted ? <PdfSheet pdf={opened.pdf} pageNumber={page} segments={segments} zoom={zoom} current={page === pageNumber} spokenParts={spokenParts} searchMatches={searchMatches} searchMatch={searchMatch} onWord={onWord} onSize={measure} onReady={ready} onRanges={updateRanges} /> : <span className="pdf-placeholder">Page {page}</span>}
    </div>;
  })}</div>;
});
