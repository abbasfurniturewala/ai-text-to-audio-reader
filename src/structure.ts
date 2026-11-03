import type { DocumentTopic, Segment } from './types';

export const NAVIGATION_VERSION = 3;
export const normalizedTitle = (text: string) => text.normalize('NFKD').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const numerals = '(?:\\d{1,4}|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty(?:[- ]\\w+)?|thirty(?:[- ]\\w+)?)';
const chapterPattern = new RegExp(`^(chapter|part|book|volume|unit|module|lesson|section)\\s+(${numerals})(?=$|[\\s.:—–-])`, 'i');
export const structuralHeading = (text: string) => chapterPattern.test(text.trim()) || /^appendix(?:\s+[A-Z\d])?(?:$|[\s:—–-])/i.test(text.trim());
export function headingDepth(text: string) {
  if (/^(part|book|volume)\s+/i.test(text)) return 0;
  if (structuralHeading(text)) return 1;
  const numbered = text.match(/^(\d+(?:\.\d+)*)(?:[.)]?\s+)\p{L}/u);
  return numbered ? numbered[1].split('.').length : 1;
}

export interface HeadingCandidate { title: string; page: number; level: number; segment?: number; y?: number }
export interface PdfLine { text: string; page: number; y: number; size: number; x: number }
export interface PdfPageHints { page: number; bodySize: number; weight: number; lines: PdfLine[]; contents: boolean; toc: string[] }

/** Small hints collected while PDF text is already being extracted. */
export function pdfPageHints(items: { str: string; transform: number[]; height: number; width: number }[], page: number): PdfPageHints {
  const lines: PdfLine[] = [], sizes = new Map<number, number>();
  for (const item of items) {
    if (!item.str.trim()) continue;
    const size = Math.round(Math.abs(item.height || item.transform[0]) * 2) / 2 || 12;
    sizes.set(size, (sizes.get(size) || 0) + item.str.length);
    const last = lines.at(-1), y = item.transform[5], x = item.transform[4];
    if (last && Math.abs(last.y - y) < 2 && x >= last.x - 2) { last.text += ' ' + item.str; last.size = Math.max(last.size, size); }
    else lines.push({ text: item.str, page, y, x, size });
  }
  const bodySize = [...sizes].sort((a, b) => b[1] - a[1])[0]?.[0] || 12;
  const contents = lines.some(line => /^(?:table\s+of\s+)?contents\s*$/i.test(line.text.trim())) || (page <= 35 && lines.filter(line => structuralHeading(line.text)).length >= 3);
  const weight = [...sizes.values()].reduce((sum, size) => sum + size, 0);
  const joined: PdfLine[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = { ...lines[index] }, next = lines[index + 1];
    // Novels often put CHAPTER and its number on separate display lines.
    if (/^(chapter|part|book|volume|unit|module|lesson|section)$/i.test(line.text.trim()) && next && line.y > next.y && line.y - next.y <= Math.max(line.size, next.size) * 3 && structuralHeading(`${line.text} ${next.text}`)) {
      line.text += ` ${next.text}`; line.size = Math.max(line.size, next.size); index++;
    }
    joined.push(line);
  }
  const hints = joined.filter(line => line.text.trim().length <= 190 && (line.size > bodySize * 1.1 || structuralHeading(line.text) || weight < 500)).slice(0, 24);
  return { page, bodySize, weight, lines: hints, contents, toc: page <= 40 ? lines.map(line => line.text.trim()) : [] };
}

export function candidateTree(candidates: HeadingCandidate[]): DocumentTopic[] {
  const roots: DocumentTopic[] = [], stack: { level: number; topic: DocumentTopic }[] = [], seen = new Set<string>();
  for (const candidate of candidates) {
    let parentCount = stack.length;
    while (parentCount && stack[parentCount - 1].level >= candidate.level) parentCount--;
    const key = stack.slice(0, parentCount).map(item => normalizedTitle(item.topic.title)).join('/') + '/' + normalizedTitle(candidate.title) + (structuralHeading(candidate.title) ? '' : `:${candidate.page}`);
    if (!key || seen.has(key)) continue;
    stack.length = parentCount;
    seen.add(key);
    const topic: DocumentTopic = { title: candidate.title, page: candidate.page, ...(candidate.segment !== undefined ? { segment: candidate.segment } : {}), ...(candidate.y !== undefined ? { y: candidate.y } : {}) };
    if (stack.length) (stack.at(-1)!.topic.children ||= []).push(topic); else roots.push(topic);
    stack.push({ level: candidate.level, topic });
    if (seen.size >= 2000) break;
  }
  return roots;
}

/** Retain all headings on a page, rather than deduplicating by page number. */
export function attachTopicTargets(topics: DocumentTopic[], segments: Segment[]): DocumentTopic[] {
  const pages = new Map<number, { text: string; index: number }[]>();
  segments.forEach((segment, index) => { const entries = pages.get(segment.page) || []; entries.push({ text: segment.text, index }); pages.set(segment.page, entries); });
  function map(topic: DocumentTopic): DocumentTopic {
    const entries = pages.get(topic.page) || [];
    const variants = [topic.title, topic.title.replace(chapterPattern, '').replace(/^[\s:—–.-]+/, '')].map(normalizedTitle).filter(text => text.length >= 3);
    let match = entries.find(entry => variants.includes(normalizedTitle(entry.text)));
    if (!match) match = entries.find(entry => entry.text.length < 220 && variants.some(title => normalizedTitle(entry.text).startsWith(title)));
    const children = topic.children?.map(map);
    return { ...topic, ...(match && topic.segment === undefined ? { segment: match.index, character: 0 } : {}), ...(children?.length ? { children } : {}) };
  }
  return topics.map(map);
}

export function groupOpeningPages(topics: DocumentTopic[]): DocumentTopic[] {
  if (!topics.length) return [];
  const main = (title: string) => structuralHeading(title) || /^\d{1,3}(?!\d|\.\d)[.)\s:–—-]+\p{L}/u.test(title);
  const firstChapter = topics.findIndex(topic => main(topic.title));
  if (firstChapter > 0 && topics.slice(firstChapter).filter(topic => main(topic.title)).length >= 2) return [{ title: 'Opening pages', page: 1, children: topics.slice(0, firstChapter) }, ...topics.slice(firstChapter)];
  return topics[0].page > 1 ? [{ title: 'Opening pages', page: 1 }, ...topics] : topics;
}

export function textTopics(segments: Segment[], pdf = false): DocumentTopic[] {
  const tocPages = new Set<number>();
  if (pdf) {
    const counts = new Map<number, number>();
    for (const segment of segments) if (structuralHeading(segment.text) && segment.text.length < 150) counts.set(segment.page, (counts.get(segment.page) || 0) + 1);
    for (const [page, count] of counts) if (page <= 35 && count >= 3) tocPages.add(page);
  }
  const candidates: HeadingCandidate[] = [], numbered: HeadingCandidate[] = [];
  const hasParts = segments.some(segment => /^(part|book|volume)\s+/i.test(segment.text) && structuralHeading(segment.text));
  segments.forEach((segment, index) => {
    const text = segment.text.trim();
    if (!text || text.length > 190 || tocPages.has(segment.page)) return;
    const markdown = text.match(/^(#{1,6})\s+(.+?)(?:\s+#+)?$/);
    if (segment.headingLevel) candidates.push({ title: text, page: segment.page, level: segment.headingLevel, segment: index });
    else if (markdown) candidates.push({ title: markdown[2], page: segment.page, level: markdown[1].length, segment: index });
    else if (structuralHeading(text) && (segment.heading || !/[.!?]$/.test(text))) candidates.push({ title: text, page: segment.page, level: headingDepth(text) + (hasParts ? 0 : -1), segment: index });
    else if (/^\d+(?:\.\d+)*[.)]?\s+\p{L}/u.test(text) && segment.heading && !/[.!?]$/.test(text)) numbered.push({ title: text, page: segment.page, level: headingDepth(text), segment: index });
    else if (!pdf && segment.heading && text.split(/\s+/).length <= 14) candidates.push({ title: text, page: segment.page, level: 1, segment: index });
  });
  if (!pdf && numbered.length >= 2) candidates.push(...numbered);
  candidates.sort((a, b) => a.segment! - b.segment!);
  return candidateTree(candidates);
}

export function topicsFromPdfHints(hints: PdfPageHints[], segments: Segment[], labels: string[] = []): { topics: DocumentTopic[]; source: 'headings' | 'contents' | 'none' } {
  const contents = new Set(hints.filter(page => page.contents).map(page => page.page));
  const bodySizes = new Map<number, number>();
  for (const page of hints) bodySizes.set(page.bodySize, (bodySizes.get(page.bodySize) || 0) + page.weight);
  const body = [...bodySizes].sort((a, b) => b[1] - a[1])[0]?.[0] || 12;
  const lines = hints.filter(page => !contents.has(page.page)).flatMap(page => page.lines);
  const repeats = new Map<string, number>();
  for (const line of lines) { const key = `${normalizedTitle(line.text)}:${line.size}`; repeats.set(key, (repeats.get(key) || 0) + 1); }
  const fontSizes = [...new Set(lines.filter(line => line.size >= body * 1.14).map(line => line.size))].sort((a, b) => b - a);
  const hasParts = lines.some(line => /^(part|book|volume)\s+/i.test(line.text) && structuralHeading(line.text));
  const candidates: HeadingCandidate[] = [];
  for (const line of lines) {
    const title = line.text.replace(/\s+/g, ' ').trim();
    if (title.length < 2 || title.length > 180 || /[;,]$/.test(title) || /^(?:figure|table|example|exercise)\b/i.test(title)) continue;
    const structural = structuralHeading(title);
    if (!structural && ((repeats.get(`${normalizedTitle(title)}:${line.size}`) || 0) > 2 || line.size < body * 1.14 || (/[.!?]$/.test(title) && line.size < body * 1.4) || (line.page === 1 && line.size > body * 3.5))) continue;
    const level = structural ? headingDepth(title) + (hasParts ? 0 : -1) : /^\d+(?:\.\d+)*\s/.test(title) ? headingDepth(title) : Math.min(5, 1 + fontSizes.indexOf(line.size));
    candidates.push({ title, page: line.page, y: line.y, level });
  }
  function flatten(topics: DocumentTopic[], level = 0) { for (const topic of topics) { candidates.push({ title: topic.title, page: topic.page, level, segment: topic.segment }); flatten(topic.children || [], level + 1); } }
  flatten(textTopics(segments, true));
  candidates.sort((a, b) => a.page - b.page || ((b.y ?? 10000) - (a.y ?? 10000)));
  let topics = candidateTree(candidates);
  const tocEntries: { title: string; printed: string; level: number }[] = [];
  for (const hint of hints.filter(page => page.contents)) for (const line of hint.toc) {
    const entry = line.match(/^(.+?\p{L}.*?)\s*(?:\.{2,}|\s)\s*(\d{1,4}|[ivxlcdm]+)\s*$/iu);
    if (entry && entry[1].length >= 3 && entry[1].length <= 170) tocEntries.push({ title: entry[1].replace(/[.\s]+$/, '').trim(), printed: entry[2], level: headingDepth(entry[1]) });
  }
  if (tocEntries.length >= 2) {
    const segmentTitles = new Map<string, number>();
    segments.forEach((segment, index) => { if (!contents.has(segment.page)) { const key = normalizedTitle(segment.text); if (!segmentTitles.has(key)) segmentTitles.set(key, index); } });
    const matched = tocEntries.map(entry => {
      const key = normalizedTitle(entry.title);
      const index = segmentTitles.get(key) ?? -1;
      const labelMatches = labels.flatMap((label, index) => label === entry.printed && !contents.has(index + 1) ? [index + 1] : []);
      return { entry, index, page: index >= 0 ? segments[index].page : labelMatches.length === 1 ? labelMatches[0] : undefined };
    });
    const offsets = matched.filter(item => item.index >= 0 && /^\d+$/.test(item.entry.printed)).map(item => item.page! - Number(item.entry.printed));
    const offset = offsets.length >= 2 && offsets.every(value => value === offsets[0]) ? offsets[0] : undefined;
    const tocCandidates = matched.flatMap(({ entry, index, page }) => {
      const destination = page ?? (offset !== undefined && /^\d+$/.test(entry.printed) ? Number(entry.printed) + offset : undefined);
      return destination && destination >= 1 && destination <= hints.length && !contents.has(destination) ? [{ title: entry.title, page: destination, level: entry.level, ...(index >= 0 ? { segment: index } : {}) }] : [];
    });
    if (tocCandidates.length >= 2 && tocCandidates.length >= tocEntries.length * .6) return { topics: attachTopicTargets(groupOpeningPages(candidateTree(tocCandidates.sort((a, b) => a.page - b.page))), segments), source: 'contents' };
  }
  if (candidates.length < 2) topics = [];
  return { topics: attachTopicTargets(groupOpeningPages(topics), segments), source: topics.length ? 'headings' : 'none' };
}
