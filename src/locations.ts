import type { ReaderDocument } from './types';

export interface DocumentLocation {
  key: string;
  number: number;
  title: string;
  preview: string;
  page: number;
  start: number;
  end: number;
  children?: DocumentLocation[];
  targetSegment?: number;
  y?: number;
}

/** PDF locations preserve physical page boundaries, including pages without text.
 * Reflowable documents use headings, or small groups of passages when unheaded. */
export function documentLocations(doc: ReaderDocument | undefined): DocumentLocation[] {
  if (!doc) return [];
  if (doc.kind === 'PDF') {
    let cursor = 0;
    return Array.from({ length: doc.pageCount }, (_, index) => {
      const page = index + 1, start = cursor;
      while (cursor < doc.segments.length && doc.segments[cursor].page === page) cursor++;
      const label = doc.pageLabels?.[index];
      return {
        key: `page-${page}`, number: page, page, start, end: cursor,
        title: label && label !== String(page) ? `Page ${label} · PDF ${page}` : `Page ${page}`,
        preview: doc.segments[start]?.page === page ? doc.segments[start].text : 'No selectable text',
      };
    });
  }
  const starts = [0];
  const headings = doc.segments.flatMap((segment, index) => segment.heading && index > 0 ? [index] : []);
  if (headings.length) starts.push(...headings);
  else for (let index = 6; index < doc.segments.length; index += 6) starts.push(index);
  return starts.map((start, index) => ({
    key: `section-${index + 1}`, number: index + 1, page: 1, start, end: starts[index + 1] ?? doc.segments.length,
    title: doc.segments[start]?.heading ? doc.segments[start].text : `Section ${index + 1}`,
    preview: doc.segments[start + (doc.segments[start]?.heading ? 1 : 0)]?.text || doc.segments[start]?.text || '',
  }));
}

export function locationForPosition(locations: DocumentLocation[], position: number) {
  return locations.find(location => position >= location.start && position < location.end) || locations[0];
}

export function chapterLocations(doc: ReaderDocument | undefined, pages: DocumentLocation[]): DocumentLocation[] {
  if (!doc?.topics?.length) return [];
  function map(topics: NonNullable<ReaderDocument['topics']>, path = ''): DocumentLocation[] {
    return topics.flatMap((topic, index) => {
      const location = doc!.kind === 'PDF' ? pages.find(page => page.page === topic.page) : pages.find(section => (topic.segment ?? 0) >= section.start && (topic.segment ?? 0) < section.end);
      if (!location) return [];
      const key = `topic-${path}${index}`, label = doc!.pageLabels?.[topic.page - 1];
      return [{ ...location, key, start: topic.segment ?? location.start, number: index + 1, title: topic.title,
        preview: doc!.kind === 'PDF' ? label && label !== String(topic.page) ? `Page ${label} · PDF ${topic.page}` : `PDF page ${topic.page}` : `Section ${location.number}`,
        ...(topic.segment !== undefined ? { targetSegment: topic.segment } : {}), ...(topic.y !== undefined ? { y: topic.y } : {}),
        ...(topic.children?.length ? { children: map(topic.children, `${path}${index}-`) } : {}) }];
    });
  }
  return map(doc.topics);
}

export function flattenLocations(entries: DocumentLocation[]): DocumentLocation[] {
  return entries.flatMap(entry => [entry, ...flattenLocations(entry.children || [])]);
}

export function chapterAtPage(chapters: DocumentLocation[], page: number, segment?: number): string {
  // If several destinations share a page and cannot be mapped to paragraphs,
  // keep the parent selected rather than pretending to know the subsection.
  const sharedPage = chapters.filter(chapter => chapter.page === page);
  if (segment !== undefined && sharedPage.length > 1 && sharedPage.some(chapter => chapter.targetSegment === undefined)) return '';
  const current = [...chapters].reverse().find(chapter => chapter.page < page || (chapter.page === page && (segment === undefined || chapter.start <= segment)));
  if (!current) return '';
  // Without a paragraph position (original PDF view), show the main chapter
  // rather than falsely selecting one of several headings on the same page.
  return segment !== undefined ? chapterAtPage(current.children || [], page, segment) || current.key : current.key;
}

export function locationPath(entries: DocumentLocation[], key: string): DocumentLocation[] {
  for (const entry of entries) {
    if (entry.key === key) return [entry];
    const children = locationPath(entry.children || [], key);
    if (children.length) return [entry, ...children];
  }
  return [];
}

export function chapterRemainingWords(chapters: DocumentLocation[], locations: DocumentLocation[], wordOffsets: number[], position: number, fraction = 0): { title: string; words: number; endSegment: number } | undefined {
  if (wordOffsets.length <= 1) return;
  const before = wordOffsets[position] || 0, segWords = (wordOffsets[position + 1] ?? before) - before;
  const spoken = before + segWords * Math.max(0, Math.min(1, fraction));
  if (chapters.length) {
    const flat = flattenLocations(chapters).map(entry => ({ ...entry, at: entry.targetSegment ?? entry.start })).sort((a, b) => a.at - b.at);
    let currentTitle = 'Opening pages';
    for (const entry of flat) if (entry.at <= position) currentTitle = entry.title;
    const next = flat.find(entry => entry.at > position);
    const endSegment = next ? next.at : wordOffsets.length - 1;
    return { title: currentTitle, words: Math.max(0, (wordOffsets[endSegment] ?? wordOffsets.at(-1)!) - spoken), endSegment };
  }
  if (locations.length > 1) {
    const loc = locationForPosition(locations, position);
    if (!loc) return;
    return { title: loc.title, words: Math.max(0, (wordOffsets[loc.end] ?? wordOffsets.at(-1)!) - spoken), endSegment: loc.end };
  }
}

export interface ExportChapter {
  key: string;
  title: string;
  start: number;
  end: number;
  page: number;
  words: number;
  backMatter: boolean;
}

const BACK_MATTER_RE = /^(index|bibliography|references|works cited|endnotes|notes|footnotes|glossary|acknowledg(e)?ments|about the author|copyright|colophon|appendix|appendices|further reading|sources)\b/i;

export function exportableChapters(doc: ReaderDocument | undefined): ExportChapter[] {
  if (!doc?.segments.length) return [];
  const pages = documentLocations(doc), chapters = chapterLocations(doc, pages);
  const raw: { key: string; title: string; start: number; page: number }[] = [];
  if (chapters.length) {
    const sorted = [...chapters].map(item => ({ key: item.key, title: item.title, start: item.targetSegment ?? item.start, page: item.page })).sort((a, b) => a.start - b.start);
    if (sorted[0].start > 0) raw.push({ key: 'opening', title: 'Opening pages', start: 0, page: doc.segments[0]?.page || 1 });
    for (const item of sorted) {
      if (raw.length && item.start <= raw.at(-1)!.start) continue;
      raw.push(item);
    }
  } else {
    for (const loc of pages) if (loc.end > loc.start) raw.push({ key: loc.key, title: loc.title, start: loc.start, page: loc.page });
  }
  return raw.map((item, index) => {
    const end = index + 1 < raw.length ? raw[index + 1].start : doc.segments.length;
    const words = doc.segments.slice(item.start, end).reduce((sum, seg) => sum + seg.text.split(/\s+/).length, 0);
    return { ...item, end, words, backMatter: BACK_MATTER_RE.test(item.title.trim()) };
  }).filter(item => item.end > item.start);
}

export function filterDocumentByChapters(doc: ReaderDocument, selectedKeys: ReadonlySet<string>, chapters = exportableChapters(doc)): Pick<ReaderDocument, 'id' | 'title' | 'kind' | 'segments' | 'pageCount' | 'topics' | 'pageLabels'> {
  const chosen = chapters.filter(item => selectedKeys.has(item.key));
  if (!chosen.length || chosen.length === chapters.length) {
    const { id, title, kind, segments, pageCount, topics, pageLabels } = doc;
    return { id, title, kind, segments, pageCount, topics, pageLabels };
  }
  const segments: ReaderDocument['segments'] = [];
  const topics: NonNullable<ReaderDocument['topics']> = [];
  for (const chapter of chosen) {
    const slice = doc.segments.slice(chapter.start, chapter.end);
    if (!slice.length) continue;
    const segment = segments.length;
    segments.push(...slice);
    topics.push({ title: chapter.title, page: slice[0].page, segment });
  }
  return { id: doc.id, title: doc.title, kind: doc.kind, segments, pageCount: doc.pageCount, topics, ...(doc.pageLabels ? { pageLabels: doc.pageLabels } : {}) };
}
