import type { Segment } from './types';

interface TextItem { str: string; transform: number[]; width: number; height: number }
export interface PdfMargin { text: string; zone: 'top' | 'bottom' }
export interface SpeechBounds { start: number; end: number }
interface MarginCount { pages: Set<number>; numbers: Map<number, number>; first: number; sequence: boolean; constant: boolean }
const key = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();
const short = (text: string) => text.length < 85 && !/[.!?]["'”’]*$/.test(text.trim());
function pageNumber(text: string, page: number, labels: string[]) {
  const match = text.trim().match(/^(?:page\s+)?(\d{1,4}|[ivxlcdm]{1,8})(?:\s+of\s+\d{1,4})?$/i);
  if (!match) return false;
  return key(match[1]) === key(labels[page - 1] || String(page));
}
function numeral(text: string) {
  if (/^\d{1,6}$/.test(text)) return Number(text);
  if (!/^(?=[mdclxvi]+$)m{0,3}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})$/i.test(text)) return;
  const values: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  return [...text.toLowerCase()].reduce((sum, letter, index, letters) => sum + (values[letter] < (values[letters[index + 1]] || 0) ? -values[letter] : values[letter]), 0);
}
function signature(text: string) {
  const normalized = key(text), first = normalized.match(/^(?:page\s+)?(\S+)\s+(.+)$/), last = normalized.match(/^(.+?)\s+(\S+)$/);
  if (first && numeral(first[1]) !== undefined) return { text: first[2], number: numeral(first[1]), label: first[1] };
  if (last && !/^(?:chapter|part|section|book|volume|article|act|scene|appendix|lesson|exercise)$/i.test(last[1]) && numeral(last[2]) !== undefined) return { text: last[1], number: numeral(last[2]), label: last[2] };
  return { text: normalized };
}
function countMargins(pages: { page: number; margins: PdfMargin[] }[]) {
  const counts = new Map<string, MarginCount>();
  for (const page of pages) for (const margin of page.margins) {
    const value = signature(margin.text), id = margin.zone + ':' + value.text;
    if (!counts.has(id)) counts.set(id, { pages: new Set(), numbers: new Map(), first: page.page, sequence: false, constant: false });
    const count = counts.get(id)!; count.pages.add(page.page); count.first = Math.min(count.first, page.page);
    if (value.number !== undefined) count.numbers.set(page.page, value.number);
  }
  for (const count of counts.values()) {
    const offsets = new Set([...count.numbers].map(([page, number]) => page - number));
    count.sequence = count.numbers.size >= 3 && offsets.size === 1 && [...offsets][0] >= 0;
    count.constant = count.numbers.size >= 3 && new Set(count.numbers.values()).size === 1;
  }
  return counts;
}
function runningMargin(margin: PdfMargin, page: number, counts: Map<string, MarginCount>, labels: string[], keepFirst: boolean) {
  if (pageNumber(margin.text, page, labels)) return true;
  const value = signature(margin.text), count = counts.get(margin.zone + ':' + value.text);
  if (!count || count.pages.size < 3) return false;
  if (value.number !== undefined) return pageNumber(value.label!, page, labels) || count.sequence || (count.constant && (!keepFirst || count.first !== page));
  return !keepFirst || count.first !== page;
}

export function pdfMarginCandidates(items: TextItem[], height: number): PdfMargin[] {
  const lines: { text: string; y: number; size: number }[] = [];
  const sizes = items.filter(item => item.str.trim()).map(item => Math.abs(item.height) || 12).sort((a, b) => a - b);
  const bodySize = sizes[Math.floor(sizes.length / 2)] || 12;
  for (const item of items) {
    if (!item.str.trim()) continue;
    const y = item.transform[5], size = Math.abs(item.height) || 12;
    const outer = y <= height * .08 || y >= height * .92;
    if (size > bodySize * (outer ? 1.25 : .95) || (y > height * .15 && y < height * .85)) continue;
    const previous = lines.find(line => Math.abs(line.y - y) < 2);
    if (previous) previous.text += ' ' + item.str; else lines.push({ text: item.str, y, size });
  }
  return lines.filter(line => short(line.text)).map(line => ({ text: line.text.trim(), zone: line.y >= height * .85 ? 'top' : 'bottom' }));
}

export function stripPdfRunningHeaders(pages: { page: number; segments: Segment[]; margins: PdfMargin[] }[], labels: string[] = []): Segment[] {
  const counts = countMargins(pages);
  return pages.flatMap(page => {
    const segments = page.segments.map(segment => ({ ...segment }));
    for (const margin of page.margins) {
      const chapter = /^(?:chapter|part|section)\b/i.test(margin.text);
      if (!runningMargin(margin, page.page, counts, labels, chapter)) continue;
      const at = margin.zone === 'top' ? 0 : segments.length - 1, segment = segments[at];
      if (!segment) continue;
      if (key(segment.text) === key(margin.text)) segments.splice(at, 1);
      else if (margin.zone === 'top' && segment.text.startsWith(margin.text + ' ')) { segment.text = segment.text.slice(margin.text.length).trim(); segment.heading = false; }
      else if (margin.zone === 'bottom' && segment.text.endsWith(' ' + margin.text)) segment.text = segment.text.slice(0, -margin.text.length).trim();
    }
    return segments;
  });
}

const cache = new WeakMap<Segment[], { labels: string[] | undefined; skipped: Set<number>; bounds: Map<number, SpeechBounds> }>();
/** Older books retain every source index; only well-supported edge passages are omitted from speech. */
export function pdfSpeechFilter(segments: Segment[], labels?: string[]) {
  const saved = cache.get(segments);
  if (saved && saved.labels === labels) return saved;
  const pages = new Map<number, number[]>(), skipped = new Set<number>(), bounds = new Map<number, SpeechBounds>();
  segments.forEach((segment, index) => { if (!pages.has(segment.page)) pages.set(segment.page, []); pages.get(segment.page)!.push(index); });
  const margins = [...pages].map(([page, indices]) => ({ page, margins: ([['top', indices[0]], ['bottom', indices.at(-1)!]] as const).flatMap(([zone, index]) => short(segments[index].text) ? [{ text: segments[index].text, zone }] : []) }));
  const counts = countMargins(margins);
  for (const [page, indices] of pages) for (const [zone, index] of [['top', indices[0]], ['bottom', indices.at(-1)!]] as const) {
    const text = segments[index].text;
    if (pageNumber(text, page, labels || [])) { skipped.add(index); continue; }
    if (indices.length < 2 || !short(text)) continue;
    if (runningMargin({ text, zone }, page, counts, labels || [], true)) skipped.add(index);
  }
  // Some decorative PDF fonts extract as a few letter/glyph codes attached to body text.
  const ornaments = new Map<string, { pages: Set<number>; cuts: { index: number; start: number }[] }>();
  for (const [page, indices] of pages) for (const index of indices.slice(0, 2)) {
    const prefix = segments[index].text.match(/^((?:[a-z]\s+)?(?:\[\S*\\\S*|[\uE000-\uF8FF]\S*)(?:\s+[a-z])?(?:\s+|$))/u)?.[0];
    if (!prefix || (prefix.match(/\p{L}/gu)?.length || 0) > 4) continue;
    const id = key(prefix); if (!ornaments.has(id)) ornaments.set(id, { pages: new Set(), cuts: [] });
    const entry = ornaments.get(id)!; entry.pages.add(page); entry.cuts.push({ index, start: prefix.length });
  }
  for (const entry of ornaments.values()) if (entry.pages.size >= 3) for (const { index, start } of entry.cuts) {
    if (start === segments[index].text.length) skipped.add(index); else bounds.set(index, { start, end: segments[index].text.length });
  }
  const result = { labels, skipped, bounds }; cache.set(segments, result);
  return result;
}
export function pdfSpeechOmissions(segments: Segment[], labels?: string[]) { return pdfSpeechFilter(segments, labels).skipped; }
