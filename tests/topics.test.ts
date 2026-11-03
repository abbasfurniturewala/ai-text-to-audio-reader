import { describe, expect, it, vi } from 'vitest';
import { mainOutlineNodes, extractPdfTopics, isMainChapter } from '../src/topics';
import { chapterLocations, chapterAtPage, documentLocations } from '../src/locations';
import type { ReaderDocument } from '../src/types';

describe('main topic navigation', () => {
  it('preserves the whole book hierarchy instead of promoting a numbered subsection list', () => {
    const children = [{ title: '1.1 Demand', dest: [2] }, { title: '1.2 Supply', dest: [3] }];
    const outline = [{ title: 'A textbook', items: [{ title: 'Contents', dest: [0] }, { title: 'Chapter 1 The Market', dest: [4], items: children }, { title: 'Chapter 2 Budget Constraint', dest: [20] }] }];
    expect(mainOutlineNodes(outline).map(item => item.title)).toEqual(['Contents', 'Chapter 1 The Market', 'Chapter 2 Budget Constraint']);
    expect(mainOutlineNodes(outline)[1].items).toEqual(children);
    expect(isMainChapter('Chapter 1')).toBe(true);
    expect(isMainChapter('1. The Market')).toBe(true);
    expect(isMainChapter('1.1 Demand')).toBe(false);
  });
  it('resolves named and reference destinations and ignores broken external links', async () => {
    const pdf = {
      numPages: 50,
      getOutline: async () => [{ title: 'Chapter 1 The Market', dest: [{ num: 7, gen: 0 }] }, { title: 'Chapter 2 Budget Constraint', dest: 'budget' }, { title: 'Chapter 3 Broken', dest: 'missing' }],
      getDestination: vi.fn(async (name: string) => name === 'budget' ? [20] : null),
      getPageIndex: vi.fn(async () => 4),
    };
    expect(await extractPdfTopics(pdf)).toEqual([{ title: 'Opening pages', page: 1 }, { title: 'Chapter 1 The Market', page: 5 }, { title: 'Chapter 2 Budget Constraint', page: 21 }]);
    expect(pdf.getDestination).toHaveBeenCalledWith('budget');
  });
  it('uses top-level named topics when there are no numbered chapters and falls back for incompatible PDFs', async () => {
    expect(mainOutlineNodes([{ title: 'A guide', items: [{ title: 'Markets', dest: [0], items: [{ title: 'Supply', dest: [1] }] }, { title: 'Budgets', dest: [2] }] }]).map(item => item.title)).toEqual(['Markets', 'Budgets']);
    expect(await extractPdfTopics({ numPages: 1, getOutline: async () => null, getDestination: async () => null, getPageIndex: async () => 0 })).toEqual([]);
  });
  it('highlights a chapter throughout its pages while physical page navigation remains available', () => {
    const doc: ReaderDocument = { id: 'test', title: 'Test', kind: 'PDF', pageCount: 10, segments: [{ text: 'Text.', page: 1 }], position: 0, bookmarks: [], created: 0, updated: 0, topics: [{ title: '1 Markets', page: 3 }, { title: '2 Budgets', page: 7 }] };
    const pages = documentLocations(doc), topics = chapterLocations(doc, pages);
    expect(pages).toHaveLength(10); expect(topics).toHaveLength(2);
    expect(chapterAtPage(topics, 1)).toBe('');
    expect(chapterAtPage(topics, 6)).toBe('topic-0');
    expect(chapterAtPage(topics, 8)).toBe('topic-1');
  });
  it('keeps bare chapters, their child topics, and multiple targets on the same page', async () => {
    const pdf = { numPages: 618, getDestination: async () => null, getPageIndex: async () => 0,
      getOutline: async () => [{ title: 'Introduction', dest: [3] }, { title: 'Chapter 1', dest: [6], items: [{ title: 'A portrait', dest: [7] }] }, { title: 'Chapter 2', dest: [59] }, { title: 'Chapter 4: Talks', dest: [147], items: [{ title: '1. Harvard', dest: [149, { name: 'XYZ' }, 0, 700] }, { title: '2. Wisdom', dest: [149, { name: 'XYZ' }, 0, 300] }] }] };
    const topics = await extractPdfTopics(pdf);
    expect(topics.map(topic => topic.title)).toEqual(['Opening pages', 'Chapter 1', 'Chapter 2', 'Chapter 4: Talks']);
    expect(topics[3].children?.map(topic => [topic.title, topic.page, topic.y])).toEqual([['1. Harvard', 150, 700], ['2. Wisdom', 150, 300]]);
  });
  it('never mistakes a document Part for a disposable wrapper', () => {
    const outline = [{ title: 'Part I', dest: [0], items: [{ title: 'Chapter 1', dest: [1] }, { title: 'Chapter 2', dest: [2] }] }];
    expect(mainOutlineNodes(outline)).toEqual(outline);
  });
  it('uses unique keys and paragraph positions for two headings on one page', () => {
    const doc: ReaderDocument = { id: 'x', title: 'x', kind: 'PDF', pageCount: 4, created: 0, updated: 0, position: 0, bookmarks: [],
      segments: Array.from({ length: 8 }, (_, index) => ({ text: `Text ${index}`, page: 2 })),
      topics: [{ title: 'Chapter', page: 2, segment: 0, children: [{ title: 'Demand', page: 2, segment: 2 }, { title: 'Supply', page: 2, segment: 5 }] }] };
    const topics = chapterLocations(doc, documentLocations(doc));
    expect(topics[0].children?.map(topic => topic.key)).toEqual(['topic-0-0', 'topic-0-1']);
    expect(chapterAtPage(topics, 1, 0)).toBe('');
    expect(chapterAtPage(topics, 2, 3)).toBe('topic-0-0');
    expect(chapterAtPage(topics, 2, 6)).toBe('topic-0-1');
    expect(chapterAtPage(topics, 2)).toBe('topic-0');
    delete topics[0].children![1].targetSegment;
    expect(chapterAtPage(topics, 2, 6)).toBe('topic-0');
  });
});
