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
