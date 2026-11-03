import { createStore, get, promisifyRequest } from 'idb-keyval';
import type { LibraryItem, ReaderDocument, Segment } from './types';
import { isHeading, repairLegacyParagraphs, TEXT_VERSION } from './paragraphs';

const store = createStore('keyval-store', 'keyval');
const indexKey = 'cadence-library-index-v2';
const textKey = (id: string) => `cadence-text:${id}`;
const fileKey = (id: string) => `cadence-file:${id}`;

export function libraryItem(doc: ReaderDocument): LibraryItem {
  const { segments, bytes: _bytes, ...metadata } = doc;
  return { ...metadata, segmentCount: segments.length,
    wordCount: segments.reduce((sum, segment) => sum + (segment.text.match(/\S+/g)?.length || 0), 0),
    bookmarkPreviews: Object.fromEntries(doc.bookmarks.filter(index => segments[index]).map(index => [index, segments[index]])) };
}

/** Migrate the old all-in-one value atomically. An interrupted/failed migration
 * leaves the original library intact, including positions and bookmarks. */
export async function loadLibrary(): Promise<LibraryItem[] | undefined> {
  return store('readwrite', db => new Promise((resolve, reject) => {
    let result: LibraryItem[] | undefined;
    db.transaction.oncomplete = () => resolve(result);
    db.transaction.onabort = db.transaction.onerror = () => reject(db.transaction.error);
    const request = db.get(indexKey);
    request.onsuccess = () => {
      if (request.result !== undefined) { result = request.result; return; }
      const legacy = db.get('cadence-library-v1');
      legacy.onsuccess = () => {
        if (legacy.result === undefined) return;
        try {
          result = (legacy.result as ReaderDocument[]).map(doc => {
            db.put(doc.segments, textKey(doc.id));
            if (doc.bytes) db.put(new Blob([doc.bytes], { type: 'application/pdf' }), fileKey(doc.id));
            return libraryItem(doc);
          });
          db.put(result, indexKey);
          db.delete('cadence-library-v1');
        } catch (error) { db.transaction.abort(); reject(error); }
      };
    };
  }));
}

function changeIndex(change: (items: LibraryItem[], db: IDBObjectStore) => LibraryItem[]) {
  return store('readwrite', db => new Promise<void>((resolve, reject) => {
    const completion = promisifyRequest(db.transaction);
    completion.then(() => resolve(), reject);
    const request = db.get(indexKey);
    request.onsuccess = () => {
      try { db.put(change(request.result || [], db), indexKey); }
      catch (error) { db.transaction.abort(); reject(error); }
    };
  }));
}

export async function addDocument(doc: ReaderDocument) {
  const item = libraryItem(doc);
  await changeIndex((items, db) => {
    db.put(doc.segments, textKey(doc.id));
    if (doc.bytes) db.put(new Blob([doc.bytes], { type: 'application/pdf' }), fileKey(doc.id));
    return [item, ...items.filter(existing => existing.id !== doc.id)];
  });
  return item;
}

/** Position/bookmark writes never clone text or PDF bytes, and a late save
 * cannot resurrect a document that has already been removed. */
export async function saveLibrary(items: LibraryItem[]) {
  const updates = new Map(items.map(item => [item.id, item]));
  await changeIndex(current => current.map(item => {
    const update = updates.get(item.id);
    // A debounced save from before a text upgrade uses obsolete segment indices.
    return update && (update.textVersion || 0) >= (item.textVersion || 0) ? update : item;
  }));
}

export async function deleteDocument(id: string) {
  await changeIndex((items, db) => {
    db.delete(textKey(id)); db.delete(fileKey(id));
    return items.filter(item => item.id !== id);
  });
}

const refreshHeadings = (segments: Segment[]) => segments.map((segment, index) => ({
  ...segment,
  heading: Boolean(segment.heading || (isHeading(segment.text) && !/^[a-z]/.test(segments[index + 1]?.text.trim() || ''))),
}));

export async function loadDocumentText(id: string) {
  const segments = await get<Segment[]>(textKey(id), store);
  if (!segments) throw new Error('This document could not be opened. Try importing the original file again.');
  return refreshHeadings(segments);
}

/** Text, saved position and bookmarks change in the same transaction. No PDF
 * bytes or model work is needed, and an interrupted upgrade rolls back. */
export async function openDocumentText(id: string): Promise<{ segments: Segment[]; item: LibraryItem }> {
  return store('readwrite', db => new Promise((resolve, reject) => {
    let result: { segments: Segment[]; item: LibraryItem };
    db.transaction.oncomplete = () => resolve(result);
    db.transaction.onabort = db.transaction.onerror = () => reject(db.transaction.error || new Error('This document could not be opened.'));
    const index = db.get(indexKey);
    index.onsuccess = () => {
      const items = index.result as LibraryItem[], item = items?.find(item => item.id === id);
      if (!item) { db.transaction.abort(); return; }
      const text = db.get(textKey(id));
      text.onsuccess = () => {
        try {
          if (!text.result) throw new Error('This document has no saved text.');
          if ((item.textVersion || 0) >= TEXT_VERSION) {
            result = { segments: refreshHeadings(text.result as Segment[]), item };
            return;
          }
          const { segments, indexMap } = repairLegacyParagraphs(text.result);
          const repaired = libraryItem({ ...item, segments, textVersion: TEXT_VERSION,
            position: indexMap[item.position] ?? 0,
            bookmarks: [...new Set(item.bookmarks.map(index => indexMap[index]).filter(index => index !== undefined))] });
          db.put(segments, textKey(id));
          db.put(items.map(existing => existing.id === id ? repaired : existing), indexKey);
          result = { segments, item: repaired };
        } catch (error) { db.transaction.abort(); reject(error); }
      };
    };
  }));
}

export async function loadPdfBytes(id: string) {
  const file = await get<Blob>(fileKey(id), store);
  if (!file) throw new Error('The original PDF could not be opened. Try importing it again.');
  return file.arrayBuffer();
}
