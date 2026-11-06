import { describe, expect, it } from 'vitest';
import { pdfMarginCandidates, pdfSpeechFilter, stripPdfRunningHeaders } from '../src/pdfMargins';
import { documentSpeechPlan, documentSpeechSource, speechPlan } from '../src/speechPlan';
import type { ReaderDocument, Segment } from '../src/types';

const document = (segments: Segment[], labels?: string[]): ReaderDocument => ({ id: 'margins', title: 'A novel', kind: 'PDF', segments, pageCount: 40, pageLabels: labels, position: 0, bookmarks: [], created: 0, updated: 0 });
const before = 'The subdued smile expressed a continual consciousness of her charming defect, which';
const after = 'she neither wished nor could conceal.';
const labels = Array.from({ length: 40 }, (_, index) => String(index - 23));
const legacy = () => [28, 29, 30].flatMap((page, index) => [
  { text: index % 2 ? `Book One: 1805 Chapter I ${page - 24}` : `${page - 24} Book One: 1805 Chapter I`, page, heading: true },
  { text: 'h [a\\ g ' + (index === 1 ? after : 'An ordinary body paragraph describes a long and interesting afternoon.'), page, heading: false },
  { text: before, page, heading: false },
  { text: `${page - 24} War and Peace`, page, heading: true },
]);

describe('PDF running margins', () => {
  it('finds small-font inner margins while protecting full-size body lines and large real headings', () => {
    const item = (str: string, y: number, height: number) => ({ str, transform: [1, 0, 0, 1, 54, y], width: 180, height });
    const items = [...Array.from({ length: 12 }, (_, index) => item('An ordinary body line.', 580 - index * 30, 12)), item('4 War and Peace', 86, 8), item('h [a\\ g', 613, 11), item('A body line at the top', 593, 12), item('Chapter I', 620, 24)];
    expect(pdfMarginCandidates(items, 680)).toEqual([{ text: '4 War and Peace', zone: 'bottom' }, { text: 'h [a\\ g', zone: 'top' }]);
  });
  it('removes changing numbered headers and footers from new imports without losing a true chapter heading', () => {
    const pages = [28, 29, 30].map((page, index) => ({ page, segments: [
      { text: `${page - 24} Book One: 1805 Chapter I`, page, heading: true },
      { text: 'h [a\\ g ' + (index === 0 ? before : after), page, heading: false },
      { text: `${page - 24} War and Peace`, page, heading: true },
    ], margins: [
      { text: `${page - 24} Book One: 1805 Chapter I`, zone: 'top' as const }, { text: 'h [a\\ g', zone: 'top' as const },
      { text: `${page - 24} War and Peace`, zone: 'bottom' as const },
    ] }));
    const cleaned = stripPdfRunningHeaders(pages, labels);
    expect(cleaned.map(segment => segment.text)).toEqual([before, after, after]);
    expect(speechPlan(cleaned)[0].text).toBe(before + ' ' + after);
    expect(pages[0].segments[1].text.startsWith('h [a\\ g')).toBe(true);
    const chapters = [1, 2, 3].map(page => ({ page, segments: [{ text: 'Chapter I', page, heading: true }, { text: 'The story begins.', page }], margins: [{ text: 'Chapter I', zone: 'top' as const }] }));
    expect(stripPdfRunningHeaders(chapters).filter(segment => segment.text === 'Chapter I')).toHaveLength(1);
  });
  it('repairs already-saved narration across the exact page break without editing text or source indices', () => {
    const segments = legacy(), saved = structuredClone(segments), doc = document(segments, labels);
    const planned = documentSpeechPlan(doc, 2), first = planned[0];
    expect(first.text).toBe(before + ' ' + after);
    expect(first.parts).toEqual([{ segment: 2, start: 0, end: before.length, offset: 0 }, { segment: 5, start: 8, end: segments[5].text.length, offset: before.length + 1 }]);
    expect(planned.map(chunk => chunk.text).join(' ')).not.toMatch(/War and Peace|Book One|Chapter I|\[a\\/);
    expect(segments).toEqual(saved);
    const streamed = documentSpeechSource(doc, 2), actual = [];
    for (let index = 0; streamed.get(index); index++) actual.push(streamed.get(index));
    expect(actual).toEqual(planned);
    const start = segments[5].text.indexOf('neither');
    expect(documentSpeechPlan(doc, 5, start + 2)[0].text.startsWith('neither wished')).toBe(true);
    expect(documentSpeechPlan(doc, 5, 0)[0].parts[0].start).toBe(8);
    expect(documentSpeechPlan(doc, 3)[0].text.startsWith(after)).toBe(true);
    expect(documentSpeechPlan(doc, 4)[0].parts[0]).toMatchObject({ segment: 5, start: 8 });
  });
  it('recognizes consistent printed-number offsets even before PDF labels arrive', () => {
    const filter = pdfSpeechFilter(legacy());
    expect([...filter.skipped].sort((a, b) => a - b)).toEqual([0, 3, 4, 7, 8, 11]);
  });
  it('retains repeated static-year cleanup without treating changing body numbers as page counters', () => {
    const segments = [1, 2, 3].flatMap(page => [{ text: 'Research report 1805', page }, { text: 'An ordinary body paragraph ends here.', page }, { text: `${page * 7} possible examples`, page }]);
    expect([...pdfSpeechFilter(segments).skipped]).toEqual([3, 6]);
    const years = [1, 2, 3].flatMap(page => [{ text: `${2000 + page} Revenue`, page, heading: true }, { text: 'The annual results remain part of the document.', page }]);
    expect(pdfSpeechFilter(years).skipped.size).toBe(0);
  });
  it('keeps genuine titles, body numbers, single occurrences and ordinary paragraph prefixes', () => {
    const segments = [1, 2, 3].flatMap(page => [{ text: `Chapter ${page}`, page, heading: true }, { text: 'I [a] explain the formula and keep the ordinary sentence.', page, heading: false }, { text: 'There are 1805 examples in this paragraph.', page, heading: false }]);
    expect(pdfSpeechFilter(segments).skipped.size).toBe(0); expect(pdfSpeechFilter(segments).bounds.size).toBe(0);
    const paths = [1, 2, 3].flatMap(page => [{ text: 'C:\\a\\b An ordinary Windows path stays in the source.', page }, { text: 'The paragraph ends here.', page }]);
    expect(pdfSpeechFilter(paths).bounds.size).toBe(0);
    const articles = ['I', 'II', 'III'].flatMap((number, index) => [{ text: `Article ${number}`, page: index + 1, heading: true }, { text: 'An ordinary body paragraph.', page: index + 1 }]);
    expect(pdfSpeechFilter(articles).skipped.size).toBe(0);
    const unique = [{ text: 'War and Peace', page: 1, heading: true }, { text: 'The story begins.', page: 1 }];
    expect(pdfSpeechFilter(unique).skipped.size).toBe(0);
    expect(documentSpeechPlan({ ...document(legacy(), labels), kind: 'DOCX' }).map(chunk => chunk.text).join(' ')).toContain('War and Peace');
  });
});
