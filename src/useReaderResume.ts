import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { readReaderSession, resolveReadingCheckpoint, writeReadingCheckpoint, type ReadingCheckpoint } from './readerSession';
import type { DocumentLocation } from './locations';
import type { ReaderDocument } from './types';

interface Options {
  doc?: ReaderDocument; locations: DocumentLocation[]; scroll: RefObject<HTMLDivElement | null>;
  reading: boolean; original: boolean; pdfPage: number; visibleLocation: string; visiblePassage: number; search: string;
  restore(location: DocumentLocation, checkpoint: ReadingCheckpoint): void;
  onError(): void;
}
export function useReaderResume(options: Options) {
  const latest = useRef(options); latest.current = options;
  const ready = useRef('');
  const cancelPending = useRef<() => void>(() => {});
  const failed = useRef(false);
  const save = useCallback((id: string, point: ReadingCheckpoint) => {
    try { writeReadingCheckpoint(localStorage, id, point); }
    catch { if (!failed.current) { failed.current = true; latest.current.onError(); } }
  }, []);
  const flush = useCallback(() => {
    const { doc, scroll, locations, reading, original, pdfPage, search } = latest.current;
    const scroller = scroll.current;
    if (!doc || !reading || !scroller || ready.current !== doc.id || search) return;
    if (original) { save(doc.id, { page: pdfPage, original: true }); return; }
    const top = scroller.getBoundingClientRect().top;
    const sections = Array.from(scroller.querySelectorAll<HTMLElement>('[data-location-key]'));
    const section = sections.find(element => element.getBoundingClientRect().bottom > top + 24) || sections.at(-1);
    const location = locations.find(item => item.key === section?.dataset.locationKey);
    if (!section || !location || section.dataset.mounted !== 'true') return;
    const passages = Array.from(section.querySelectorAll<HTMLElement>('[data-passage-index]'));
    const passage = passages.find(element => element.getBoundingClientRect().bottom > top + 24) || passages.at(-1);
    const segment = passage ? Number(passage.dataset.passageIndex) : undefined;
    save(doc.id, { page: location.page, original: false, ...(segment !== undefined ? { segment } : {}) });
  }, [save]);
  const interrupt = useCallback(() => cancelPending.current(), []);

  useLayoutEffect(() => {
    const { doc, locations, reading, restore } = latest.current;
    ready.current = '';
    if (!doc || !reading || !locations.length) return;
    const point = resolveReadingCheckpoint(doc, locations, readReaderSession(localStorage).books[doc.id]);
    const location = doc.kind === 'PDF' ? locations.find(item => item.page === point.page)! : locations.find(item => (point.segment ?? 0) >= item.start && (point.segment ?? 0) < item.end) || locations[0];
    // Save the validated choice before painting, so an early close cannot replace
    // a good checkpoint with the initial page-one render.
    save(doc.id, point);
    restore(location, point);
    let frame = 0, settled = 0, cancelled = false;
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    const stopListening = () => events.forEach(name => window.removeEventListener(name, interrupt, true));
    cancelPending.current = () => {
      cancelled = true; cancelAnimationFrame(frame); stopListening();
      cancelPending.current = () => {};
      ready.current = doc.id;
      flush();
    };
    events.forEach(name => window.addEventListener(name, interrupt, { capture: true, passive: true }));
    const deadline = performance.now() + 15000;
    const position = () => {
      const state = latest.current, scroller = state.scroll.current;
      if (cancelled || !scroller || state.doc?.id !== doc.id || !state.reading) return;
      if (state.original !== point.original || (point.original && state.pdfPage !== point.page)) { frame = requestAnimationFrame(position); return; }
      if (point.original) scroller.scrollTo({ top: 0, behavior: 'instant' });
      else {
        const section = scroller.querySelector<HTMLElement>(`[data-location-key="${location.key}"]`);
        const target = point.segment !== undefined ? section?.querySelector<HTMLElement>(`[data-passage-index="${point.segment}"]`) : section;
        if (!target && performance.now() < deadline) { frame = requestAnimationFrame(position); return; }
        if (target) scroller.scrollTo({ top: scroller.scrollTop + target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12, behavior: 'instant' });
      }
      // Mounting a distant virtualized page updates placeholder measurements.
      // Re-anchor over two frames before allowing ordinary location saves.
      if (++settled < 3) { frame = requestAnimationFrame(position); return; }
      ready.current = doc.id;
      stopListening(); cancelPending.current = () => {};
      flush();
    };
    frame = requestAnimationFrame(position);
    return () => { cancelled = true; cancelAnimationFrame(frame); stopListening(); cancelPending.current = () => {}; ready.current = ''; };
  }, [options.doc?.id, options.reading, save, flush, interrupt]);

  useEffect(() => { flush(); }, [options.doc?.id, options.reading, options.original, options.pdfPage, options.visibleLocation, options.visiblePassage, options.search, flush]);
  useEffect(() => {
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('beforeunload', flush); window.removeEventListener('pagehide', flush); };
  }, [flush]);
  return { flush, interrupt };
}
