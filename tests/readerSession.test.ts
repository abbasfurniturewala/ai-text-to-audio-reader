import { describe, expect, it } from 'vitest';
import { lastReaderBook, readReaderSession, READER_SESSION_KEY, removeReadingCheckpoint, resolveReadingCheckpoint, writeReadingCheckpoint } from '../src/readerSession';
import { documentLocations } from '../src/locations';
import type { ReaderDocument } from '../src/types';
function memory() {
  const values = new Map<string, string>(); let writes = 0;
  return { values, get writes() { return writes; }, getItem(key: string) { return values.get(key) ?? null; }, setItem(key: string, value: string) { writes++; values.set(key, value); } };
}
const doc: ReaderDocument = { id: 'book', title: 'Book', kind: 'PDF', segments: [{ page: 1, text: 'First page.' }, { page: 3, text: 'Third page.' }, { page: 3, text: 'Another paragraph.' }, { page: 4, text: 'Final page.' }], pageCount: 4, position: 1, bookmarks: [], created: 0, updated: 0 };
describe('small reading checkpoints', () => {
  it('remembers the last book even after Close document clears the legacy active selection', () => {
    const storage = memory();
    writeReadingCheckpoint(storage, 'second', { page: 73, segment: 900, original: false });
    storage.setItem('cadence-document', '');
    expect(lastReaderBook(storage, ['first', 'second'])).toBe('second');
    expect(readReaderSession(storage).books.second).toEqual({ page: 73, segment: 900, original: false });
  });
  it('keeps separate browsing locations while bounding storage and skipping unchanged writes', () => {
    const storage = memory();
    for (let n = 0; n < 100; n++) writeReadingCheckpoint(storage, `book-${n}`, { page: n + 1, original: false, segment: n * 10 });
    const saved = readReaderSession(storage);
    expect(Object.keys(saved.books)).toHaveLength(64);
    expect(saved.books['book-36']).toBeDefined();
    expect(saved.books['book-0']).toBeUndefined();
    expect(storage.getItem(READER_SESSION_KEY)!.length).toBeLessThan(8192);
    const writes = storage.writes;
    writeReadingCheckpoint(storage, 'book-99', { page: 100, original: false, segment: 990 });
    expect(storage.writes).toBe(writes);
  });
  it('falls back to an existing book without recreating removed or empty libraries', () => {
    const storage = memory();
    storage.setItem('cadence-document', 'legacy-book');
    expect(lastReaderBook(storage, ['first', 'legacy-book'])).toBe('legacy-book');
    writeReadingCheckpoint(storage, 'removed-book', { page: 8, original: true });
    expect(lastReaderBook(storage, ['first'])).toBe('first');
    expect(lastReaderBook(storage, [])).toBe('');
    writeReadingCheckpoint(storage, 'first', { page: 2, original: false });
    removeReadingCheckpoint(storage, 'first');
    expect(readReaderSession(storage).lastId).toBe('removed-book');
    expect(readReaderSession(storage).books.first).toBeUndefined();
  });
  it('validates corrupt state and excludes text, bytes and invalid numbers', () => {
    const storage = memory();
    storage.setItem(READER_SESSION_KEY, '{broken');
    expect(readReaderSession(storage)).toEqual({ lastId: '', books: {} });
    storage.setItem(READER_SESSION_KEY, JSON.stringify({ lastId: 'book', books: { a: { page: -1, original: true }, b: { page: 3, original: false, segment: -8, text: 'Do not save me' }, c: { page: '2', original: true } } }));
    expect(readReaderSession(storage).books).toEqual({ b: { page: 3, original: false } });
    writeReadingCheckpoint(storage, 'b', { page: 4, original: true });
    expect(storage.getItem(READER_SESSION_KEY)).not.toContain('Do not save me');
  });
  it('restores blank PDF pages and clamps outdated paragraphs without changing audio position', () => {
    const locations = documentLocations(doc);
    expect(resolveReadingCheckpoint(doc, locations, { page: 2, segment: 99, original: false })).toEqual({ page: 2, original: false });
    expect(resolveReadingCheckpoint(doc, locations, { page: 3, segment: 99, original: false })).toEqual({ page: 3, original: false, segment: 1 });
    expect(resolveReadingCheckpoint(doc, locations, { page: 999, original: true })).toEqual({ page: 4, original: true });
    expect(doc.position).toBe(1);
  });
  it('uses the old audio location only when no browsing checkpoint exists', () => {
    expect(resolveReadingCheckpoint(doc, documentLocations(doc))).toEqual({ page: 3, segment: 1, original: false });
    const text = { ...doc, kind: 'TXT' as const, pageCount: 1, segments: doc.segments.map(segment => ({ ...segment, page: 1 })) };
    expect(resolveReadingCheckpoint(text, documentLocations(text), { page: 9, segment: 2, original: true })).toEqual({ page: 1, segment: 2, original: true });
  });
  it('restores document view and exact paragraphs for every reflowable format using the existing checkpoint', () => {
    for (const kind of ['EPUB', 'DOCX', 'TXT', 'NOTE'] as const) {
      const book = { ...doc, kind, pageCount: 1, segments: doc.segments.map(segment => ({ ...segment, page: 1 })) };
      const storage = memory();
      writeReadingCheckpoint(storage, book.id, { page: 1, segment: 2, original: true });
      expect(resolveReadingCheckpoint(book, documentLocations(book), readReaderSession(storage).books[book.id])).toEqual({ page: 1, segment: 2, original: true });
      expect(resolveReadingCheckpoint(book, documentLocations(book), { page: 1, segment: 999, original: true })).toEqual({ page: 1, segment: 0, original: true });
      expect(book.position).toBe(1);
    }
  });
});
