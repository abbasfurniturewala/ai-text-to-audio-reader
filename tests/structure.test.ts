import { describe, expect, it } from 'vitest';
import { attachTopicTargets, candidateTree, groupOpeningPages, pdfPageHints, textTopics, topicsFromPdfHints, type PdfPageHints } from '../src/structure';

describe('document structure detection', () => {
  it('detects novel chapters written with numbers, Roman numerals and words, and ignores a contents page', () => {
    const segments = [
      { text: 'Chapter One', page: 2, heading: true }, { text: 'Chapter Two', page: 2, heading: true }, { text: 'Chapter Three', page: 2, heading: true },
      { text: 'Chapter One', page: 7, heading: true }, { text: 'A long story begins here.', page: 7 },
      { text: 'Chapter II', page: 20, heading: true }, { text: 'More of the story.', page: 20 },
      { text: 'Chapter 3 — Home', page: 30, heading: true }];
    expect(textTopics(segments, true).map(topic => [topic.title, topic.page])).toEqual([['Chapter One', 7], ['Chapter II', 20], ['Chapter 3 — Home', 30]]);
  });
  it('keeps Markdown and Word heading levels and target paragraphs', () => {
    const markdown = textTopics([{ text: '# Markets', page: 1 }, { text: '## Supply', page: 1 }, { text: '### Costs', page: 1 }, { text: '# Budgets', page: 1 }]);
    expect(markdown[0].children?.[0].children?.[0]).toMatchObject({ title: 'Costs', segment: 2 });
    expect(markdown[1].title).toBe('Budgets');
    const word = textTopics([{ text: 'Markets', page: 1, headingLevel: 1 }, { text: 'Supply', page: 1, headingLevel: 2 }, { text: 'Costs', page: 1, headingLevel: 3 }, { text: 'Budgets', page: 1, headingLevel: 1 }]);
    expect(word).toEqual(markdown);
  });
  it('retains repeated subsection names in different chapters', () => {
    const topics = candidateTree([{ title: 'Chapter 1', page: 1, level: 1 }, { title: 'Overview', page: 1, level: 2 }, { title: 'Chapter 2', page: 10, level: 1 }, { title: 'Overview', page: 10, level: 2 }]);
    expect(topics[0].children?.[0].title).toBe('Overview');
    expect(topics[1].children?.[0].title).toBe('Overview');
  });
  it('retains the current parent when a running chapter label repeats', () => {
    const topics = candidateTree([{ title: 'Chapter 1', page: 1, level: 0 }, { title: 'Overview', page: 1, level: 1 }, { title: 'Chapter 1', page: 2, level: 0 }, { title: 'Details', page: 2, level: 1 }, { title: 'Chapter 2', page: 5, level: 0 }]);
    expect(topics.map(topic => topic.title)).toEqual(['Chapter 1', 'Chapter 2']);
    expect(topics[0].children?.map(topic => topic.title)).toEqual(['Overview', 'Details']);
  });
  it('joins chapter labels and numbers split over display lines', () => {
    const hints = pdfPageHints(['CHAPTER', 'XII', 'The next part of the story begins here.'].map((str, index) => ({ str, height: index < 2 ? 24 : 12, width: 250, transform: [1, 0, 0, 1, 30, 700 - index * 36] })), 3);
    expect(hints.lines.some(line => line.text === 'CHAPTER XII')).toBe(true);
  });
  it('attaches two different headings on a page without dropping either one', () => {
    const topics = attachTopicTargets([{ title: '1.1 Demand', page: 4 }, { title: '1.2 Supply', page: 4 }], [{ text: '1.1 Demand', page: 4 }, { text: 'Body.', page: 4 }, { text: '1.2 Supply', page: 4 }]);
    expect(topics.map(topic => topic.segment)).toEqual([0, 2]);
  });
  it('recognizes typography and rejects repeated running headers and numbered prose', () => {
    const hints: PdfPageHints[] = Array.from({ length: 4 }, (_, index) => ({ page: index + 1, bodySize: 12, weight: 3000, contents: false, toc: [], lines: [
      { text: 'A repeated running header', page: index + 1, y: 760, x: 30, size: 15 },
      ...(index === 0 ? [{ text: 'What is a Market?', page: 1, y: 650, x: 30, size: 22 }, { text: '1.1 Supply', page: 1, y: 400, x: 30, size: 16 }] : []),
      ...(index === 3 ? [{ text: 'Budget Constraint', page: 4, y: 650, x: 30, size: 22 }] : []) ] }));
    const result = topicsFromPdfHints(hints, [{ text: '1) Do this exercise', page: 2, heading: true }, { text: '2) Do that exercise', page: 2, heading: true }]);
    expect(result.topics.map(topic => topic.title)).toEqual(['What is a Market?', 'Budget Constraint']);
    expect(result.topics[0].children?.[0].title).toBe('1.1 Supply');
    expect(result.source).toBe('headings');
  });
  it('uses contents page numbers only with a verified page-label mapping', () => {
    const hints: PdfPageHints[] = Array.from({ length: 5 }, (_, index) => ({ page: index + 1, bodySize: 12, weight: 3000, contents: index === 0, lines: [], toc: index === 0 ? ['Contents', 'Markets .... 1', 'Budgets .... 3'] : [] }));
    expect(topicsFromPdfHints(hints, [], ['i', 'ii', '1', '2', '3']).topics.map(topic => [topic.title, topic.page])).toEqual([['Opening pages', 1], ['Markets', 3], ['Budgets', 5]]);
    expect(topicsFromPdfHints(hints, []).topics).toEqual([]);
  });
  it('does not invent chapters in a plain unstructured PDF', () => {
    const hints = pdfPageHints([{ str: 'One ordinary sentence followed by another.', height: 12, width: 300, transform: [1, 0, 0, 1, 30, 700] }], 1);
    expect(topicsFromPdfHints([hints], [{ text: 'One ordinary sentence followed by another.', page: 1 }]).topics).toEqual([]);
    expect(groupOpeningPages([])).toEqual([]);
  });
});
