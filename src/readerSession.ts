import type { DocumentLocation } from './locations';
import type { ReaderDocument } from './types';

export const READER_SESSION_KEY = 'cadence-reader-session-v1';
export const BOOK_PREFS_KEY = 'cadence-book-prefs-v1';
export const BOOKMARK_NOTES_KEY = 'cadence-bookmark-notes-v1';
export const MAX_RESUME_BOOKS = 64;
export const MAX_BOOKMARK_NOTES = 512;
export interface ReadingCheckpoint { page: number; segment?: number; original: boolean }
export interface BookPreference { voice: string; speed: number }
interface ReaderSession { lastId: string; books: Record<string, ReadingCheckpoint> }
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
const validId = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 128 && !['__proto__', 'constructor', 'prototype'].includes(id);
const validVoice = (voice: unknown): voice is string => typeof voice === 'string' && /^[a-zA-Z0-9_-]{2,100}$/.test(voice);
const validSpeed = (speed: unknown): speed is number => typeof speed === 'number' && Number.isFinite(speed) && speed >= 0.65 && speed <= 1.75;
function bookPref(value: any): BookPreference | undefined {
  if (!value || !validVoice(value.voice) || !validSpeed(value.speed)) return;
  return { voice: value.voice, speed: Math.round(value.speed * 100) / 100 };
}
export function readBookPreferences(storage: Storage): Record<string, BookPreference> {
  try {
    const raw = storage.getItem(BOOK_PREFS_KEY);
    if (!raw || raw.length > 32768) return {};
    const saved = JSON.parse(raw);
    return Object.fromEntries(Object.entries(saved || {}).filter(([id, value]) => validId(id) && bookPref(value)).slice(-MAX_RESUME_BOOKS).map(([id, value]) => [id, bookPref(value)!]));
  } catch { return {}; }
}
export function readBookPreference(storage: Storage, id: string): BookPreference | undefined {
  return validId(id) ? readBookPreferences(storage)[id] : undefined;
}
export function writeBookPreference(storage: Storage, id: string, value: BookPreference) {
  if (!validId(id)) return;
  const clean = bookPref(value);
  if (!clean) return;
  const saved = readBookPreferences(storage), previous = saved[id];
  if (previous?.voice === clean.voice && previous?.speed === clean.speed) return;
  const books = Object.fromEntries([...Object.entries(saved).filter(([key]) => key !== id).slice(-(MAX_RESUME_BOOKS - 1)), [id, clean]]);
  storage.setItem(BOOK_PREFS_KEY, JSON.stringify(books));
}
const validNoteKey = (key: unknown): key is string => {
  if (typeof key !== 'string') return false;
  const colon = key.lastIndexOf(':');
  return colon > 0 && validId(key.slice(0, colon)) && /^\d+$/.test(key.slice(colon + 1));
};
export function readBookmarkNotes(storage: Storage): Record<string, string> {
  try {
    const raw = storage.getItem(BOOKMARK_NOTES_KEY);
    if (!raw || raw.length > 131072) return {};
    const saved = JSON.parse(raw);
    return Object.fromEntries(Object.entries(saved || {}).filter(([key, val]) => validNoteKey(key) && typeof val === 'string' && val.trim().length > 0).slice(-MAX_BOOKMARK_NOTES).map(([key, val]) => [key, (val as string).trim().slice(0, 500)]));
  } catch { return {}; }
}
export function writeBookmarkNote(storage: Storage, id: string, index: number, note: string): Record<string, string> {
  const key = `${id}:${index}`;
  const saved = readBookmarkNotes(storage);
  if (!validNoteKey(key)) return saved;
  const trimmed = note.trim().slice(0, 500);
  const next = Object.fromEntries(Object.entries(saved).filter(([k]) => k !== key).slice(-(MAX_BOOKMARK_NOTES - 1)));
  if (trimmed) next[key] = trimmed;
  storage.setItem(BOOKMARK_NOTES_KEY, JSON.stringify(next));
  return next;
}
export function formatBookmarksMarkdown(items: Array<{ id: string; title: string; bookmarks: number[]; bookmarkPreviews: Record<number, { text: string; page: number }> }>, notes: Record<string, string> = {}): string {
  const books = items.filter(item => item.bookmarks.length > 0);
  if (!books.length) return '# Cadence Bookmarks\n\nNo saved bookmarks.\n';
  const sections = books.map(item => {
    const entries = item.bookmarks.map(index => {
      const preview = item.bookmarkPreviews[index];
      const text = (preview?.text || '').replace(/\r?\n/g, '\n> ');
      const note = notes[`${item.id}:${index}`];
      return `> ${text}\n>\n> — *Passage ${index + 1}, Page ${preview?.page || 1}*${note ? `\n\n**Note:** ${note}` : ''}`;
    });
    return `## ${item.title}\n\n${entries.join('\n\n---\n\n')}`;
  });
  return `# Cadence Bookmarks\n\n${sections.join('\n\n')}\n`;
}
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
  if (storage.getItem(BOOK_PREFS_KEY)) {
    const prefs = readBookPreferences(storage);
    if (id in prefs) { delete prefs[id]; storage.setItem(BOOK_PREFS_KEY, JSON.stringify(prefs)); }
  }
  if (storage.getItem(BOOKMARK_NOTES_KEY)) {
    const notes = readBookmarkNotes(storage);
    const filtered = Object.fromEntries(Object.entries(notes).filter(([key]) => !key.startsWith(`${id}:`)));
    storage.setItem(BOOKMARK_NOTES_KEY, JSON.stringify(filtered));
  }
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
  const original = !!saved?.original;
  const page = doc.kind === 'PDF' ? Math.max(1, Math.min(doc.pageCount, saved?.page || doc.segments[audio]?.page || 1)) : 1;
  const segment = saved?.segment ?? (saved ? undefined : audio);
  const location = doc.kind === 'PDF' ? locations.find(item => item.page === page) : locations.find(item => (segment ?? audio) >= item.start && (segment ?? audio) < item.end) || locations[0];
  const target = segment !== undefined && location && segment >= location.start && segment < location.end ? segment : location && location.start < location.end ? location.start : undefined;
  return { page, original, ...(!(original && doc.kind === 'PDF') && target !== undefined ? { segment: target } : {}) };
}
