import type { Segment } from './types';

export interface ReaderMatch { segment: number; start: number; end: number; page: number }
export function readerMatches(segments: Segment[], query: string, limit = 2000): ReaderMatch[] {
  if (!query.trim()) return [];
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu'), result: ReaderMatch[] = [];
  for (let segment = 0; segment < segments.length; segment++) {
    for (const match of segments[segment].text.matchAll(pattern)) {
      result.push({ segment, start: match.index, end: match.index + match[0].length, page: segments[segment].page });
      if (result.length >= limit) return result;
    }
  }
  return result;
}

/** Reserve the sticky marker's real height, including wrapped labels and larger text. */
export function readingInset(section: HTMLElement | null) {
  const marker = section?.querySelector<HTMLElement>('.original-page-marker');
  if (!marker) return 12;
  const style = getComputedStyle(marker), scroller = section?.closest<HTMLElement>('.reader-scroll');
  if (style.position !== 'sticky') return 12;
  const padding = scroller ? parseFloat(getComputedStyle(scroller).paddingTop) || 0 : 0;
  return marker.getBoundingClientRect().height + Math.max(0, padding + (parseFloat(style.top) || 0)) + 16;
}
export function revealReadingTarget(scroller: HTMLElement, target: HTMLElement, center = false) {
  const viewport = scroller.getBoundingClientRect(), bounds = target.getBoundingClientRect();
  const section = target.closest<HTMLElement>('[data-location-key]');
  const inset = target !== section ? readingInset(section) : 12;
  const gap = center ? Math.max(inset, (scroller.clientHeight - bounds.height) / 2) : inset;
  const sectionTop = section ? scroller.scrollTop + section.getBoundingClientRect().top - viewport.top - 12 : 0;
  scroller.scrollTo({ top: Math.max(0, sectionTop, scroller.scrollTop + bounds.top - viewport.top - gap), behavior: 'instant' });
}
