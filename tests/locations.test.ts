import { describe, expect, it } from 'vitest';
import { chapterLocations, chapterRemainingWords, documentLocations, exportableChapters, filterDocumentByChapters, locationForPosition } from '../src/locations';
import type { ReaderDocument } from '../src/types';
const doc = (overrides: Partial<ReaderDocument> = {}): ReaderDocument => ({ id: 'test', title: 'Test', kind: 'PDF', segments: [{ text: 'First page.', page: 1 }, { text: 'Third page.', page: 3 }], pageCount: 3, position: 0, bookmarks: [], created: 0, updated: 0, ...overrides });
describe('document navigation locations', () => {
  it('preserves physical PDF pages, labels, and blank pages', () => {
    const locations = documentLocations(doc({ pageLabels: ['i', 'ii', '1'] }));
    expect(locations.map(item => [item.page, item.start, item.end])).toEqual([[1, 0, 1], [2, 1, 1], [3, 1, 2]]);
    expect(locations[0].title).toBe('Page i · PDF 1');
    expect(locations[1].preview).toBe('No selectable text');
    expect(locationForPosition(locations, 1)?.page).toBe(3);
  });
  it('groups reflowable documents by headings without inventing page numbers', () => {
    const locations = documentLocations(doc({ kind: 'DOCX', segments: [{ text: 'An introduction.', page: 1 }, { text: 'A new chapter', page: 1, heading: true }, { text: 'More words.', page: 1 }], pageCount: 1 }));
    expect(locations.map(item => [item.title, item.start, item.end])).toEqual([['Section 1', 0, 1], ['A new chapter', 1, 3]]);
    expect(locationForPosition(locations, 2)?.number).toBe(2);
  });
  it('provides navigable chunks for long unheaded text', () => {
    const locations = documentLocations(doc({ kind: 'TXT', segments: Array.from({ length: 15 }, (_, i) => ({ text: `Paragraph ${i}.`, page: 1 })) }));
    expect(locations.map(item => [item.start, item.end])).toEqual([[0, 6], [6, 12], [12, 15]]);
    expect(documentLocations(undefined)).toEqual([]);
  });
  it('calculates remaining words and end segment for the active chapter or section', () => {
    const book = doc({ kind: 'DOCX', segments: [{ text: 'Chapter One', page: 1, heading: true }, { text: 'One two three four.', page: 1 }, { text: 'Chapter Two', page: 1, heading: true }, { text: 'Five six seven.', page: 1 }], pageCount: 1 });
    const locations = documentLocations(book);
    const chapters = chapterLocations(book, locations);
    const offsets = [0, 2, 6, 8, 11];
    expect(chapterRemainingWords(chapters, locations, offsets, 0, 0)).toEqual({ title: 'Chapter One', words: 6, endSegment: 2 });
    expect(chapterRemainingWords(chapters, locations, offsets, 1, 0.5)).toEqual({ title: 'Chapter One', words: 2, endSegment: 2 });
    expect(chapterRemainingWords(chapters, locations, offsets, 2, 0)).toEqual({ title: 'Chapter Two', words: 5, endSegment: 4 });
  });
  it('identifies back matter and filters export chapters while remapping topic indices', () => {
    const book = doc({
      kind: 'EPUB',
      pageCount: 3,
      segments: [
        { text: 'Chapter 1', page: 1, heading: true },
        { text: 'Opening body text here.', page: 1 },
        { text: 'Chapter 2', page: 2, heading: true },
        { text: 'Second body text here.', page: 2 },
        { text: 'Bibliography and References', page: 3, heading: true },
        { text: 'Smith 1999, Jones 2004.', page: 3 },
      ],
      topics: [
        { title: 'Chapter 1', page: 1, segment: 0 },
        { title: 'Chapter 2', page: 2, segment: 2 },
        { title: 'Bibliography and References', page: 3, segment: 4 },
      ],
    });
    const chapters = exportableChapters(book);
    expect(chapters.map(ch => [ch.title, ch.backMatter])).toEqual([
      ['Chapter 1', false],
      ['Chapter 2', false],
      ['Bibliography and References', true],
    ]);
    const filtered = filterDocumentByChapters(book, new Set([chapters[1].key]), chapters);
    expect(filtered.segments.map(s => s.text)).toEqual(['Chapter 2', 'Second body text here.']);
    expect(filtered.topics).toEqual([{ title: 'Chapter 2', page: 2, segment: 0 }]);
  });
});
