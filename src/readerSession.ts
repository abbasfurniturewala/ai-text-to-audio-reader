import type { DocumentLocation } from './locations';
import type { ReaderDocument } from './types';

export const READER_SESSION_KEY = 'cadence-reader-session-v1';
export const MAX_RESUME_BOOKS = 64;
export interface ReadingCheckpoint { page: number; segment?: number; original: boolean }
interface ReaderSession { lastId: string; books: Record<string, ReadingCheckpoint> }
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
const validId = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 128 && !['__proto__', 'constructor', 'prototype'].includes(id);
function checkpoint(value: any): ReadingCheckpoint | undefined {
  if (!value || !Number.isSafeInteger(value.page) || value.page < 1 || value.page > 1000000 || typeof value.original !== 'boolean') return;
  return { page: value.page, original: value.original, ...(Number.isSafeInteger(value.segment) && value.segment >= 0 ? { segment: value.segment } : {}) };
}
export function readReaderSession(storage: Storage): ReaderSession {
  try {
    const raw = storage.getItem(READER_SESSION_KEY);
    if (!raw || raw.length > 32768) return { lastId: '', books: {} };
    const saved = JSON.parse(raw);
    const books = Object.fromEntries(Object.entries(saved.books || {}).filter(([id, value]) => validId(id) && checkpoint(value)).slice(-MAX_RESUME_BOOKS).map(([id, value]) => [id, checkpoint(value)!]));
    return { lastId: validId(saved.lastId) ? saved.lastId : '', books };
  } catch { return { lastId: '', books: {} }; }
}
/** One bounded record of numbers/IDs, never document text, PDF bytes or audio. */
export function writeReadingCheckpoint(storage: Storage, id: string, location: ReadingCheckpoint) {
  if (!validId(id)) return;
  const clean = checkpoint(location);
  if (!clean) return;
  const saved = readReaderSession(storage), previous = saved.books[id];
  if (saved.lastId === id && previous?.page === clean.page && previous?.segment === clean.segment && previous?.original === clean.original) return;
  const books = Object.fromEntries([...Object.entries(saved.books).filter(([key]) => key !== id).slice(-(MAX_RESUME_BOOKS - 1)), [id, clean]]);
  storage.setItem(READER_SESSION_KEY, JSON.stringify({ lastId: id, books }));
}
export function removeReadingCheckpoint(storage: Storage, id: string) {
  const saved = readReaderSession(storage);
  delete saved.books[id];
  if (saved.lastId === id) saved.lastId = Object.keys(saved.books).at(-1) || '';
  storage.setItem(READER_SESSION_KEY, JSON.stringify(saved));
}
export function lastReaderBook(storage: Storage, ids: string[]) {
  const saved = readReaderSession(storage).lastId;
  if (ids.includes(saved)) return saved;
  let legacy: string | null = null;
  try { legacy = storage.getItem('cadence-document'); } catch { /* The library is still usable if browser storage is unavailable. */ }
  return legacy && ids.includes(legacy) ? legacy : ids[0] || '';
}
/** Validate old checkpoints against today's page and paragraph boundaries. */
export function resolveReadingCheckpoint(doc: ReaderDocument, locations: DocumentLocation[], saved?: ReadingCheckpoint): ReadingCheckpoint {
  const audio = Math.max(0, Math.min(doc.segments.length - 1, doc.position));
  const original = doc.kind === 'PDF' && !!saved?.original;
  const page = doc.kind === 'PDF' ? Math.max(1, Math.min(doc.pageCount, saved?.page || doc.segments[audio]?.page || 1)) : 1;
  const segment = saved?.segment ?? (saved ? undefined : audio);
  const location = doc.kind === 'PDF' ? locations.find(item => item.page === page) : locations.find(item => (segment ?? audio) >= item.start && (segment ?? audio) < item.end) || locations[0];
  const target = segment !== undefined && location && segment >= location.start && segment < location.end ? segment : location && location.start < location.end ? location.start : undefined;
  return { page, original, ...(!original && target !== undefined ? { segment: target } : {}) };
}
