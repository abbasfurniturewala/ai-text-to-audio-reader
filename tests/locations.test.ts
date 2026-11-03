import { describe, expect, it } from 'vitest';
import { documentLocations, locationForPosition } from '../src/locations';
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
});
