import { describe, expect, it } from 'vitest';
import { speechPlan, chunkPosition, wordStart, iterateSpeech, documentSpeechSource, documentSpeechPlan } from '../src/speechPlan';
import { mapPdfText, pdfSpeechRanges } from '../src/pdfWords';
import { SegmentQueue } from '../src/segmentSource';
import type { ReaderDocument, Segment } from '../src/types';

describe('sentence planning', () => {
  it('pulls opening speech without scanning a large book or exposing a mutable heading', () => {
    let visited = 0;
    const segments = Array.from({ length: 50000 }, (_, index) => ({ get text() { visited++; return `This complete sentence describes the story at passage ${index}.`; }, page: index + 1 }));
    const source = new SegmentQueue(iterateSpeech(segments));
    expect(source.length).toBe(Infinity);
    expect(source.get(0)?.text).toBe('This complete sentence describes the story at passage 0.');
    expect(visited).toBeLessThan(20); expect(source.retained).toBe(1);
    const short = new SegmentQueue(iterateSpeech([{ text: 'Part I', page: 1, heading: true }, { text: 'A short opening.', page: 1 }, { text: 'A longer complete sentence makes the next unit distinct.', page: 1 }]));
    const first = short.get(0)!, saved = structuredClone(first);
    expect(first.text).toBe('Part I\n\nA short opening.');
    expect(first.parts).toEqual([{ segment: 0, start: 0, end: 6, offset: 0 }, { segment: 1, start: 0, end: 16, offset: 8 }]);
    short.get(2); expect(short.length).toBe(2); expect(first).toEqual(saved);
  });
  it('releases consumed metadata and discovers the exact end without retaining the book plan', () => {
    const source = new SegmentQueue(iterateSpeech(Array.from({ length: 10000 }, (_, index) => ({ text: `This complete sentence is long enough to remain separate at ${index}.`, page: index + 1 }))));
    for (let index = 0; index < 10000; index++) {
      source.get(index + 12); source.release(index - 2);
      expect(source.retained).toBeLessThanOrEqual(15);
    }
    expect(source.length).toBe(10000); expect(source.get(0)).toBeUndefined();
    expect(source.get(9999)?.parts[0].segment).toBe(9999); expect(source.get(10000)).toBeUndefined();
  });
  it('keeps streamed PDF omissions, Unicode offsets and cross-page source ranges identical to export', () => {
    const segments: Segment[] = [
      { text: 'Before this point, don’t stop café readers and', page: 1, heading: false },
      { text: '1', page: 1 }, { text: 'finish the complete sentence here. Dr. Davis follows with a different thought.', page: 2, heading: false },
      { text: '2', page: 2 }, { text: 'Another ordinary body paragraph finishes the book.', page: 3, heading: false }, { text: '3', page: 3 },
    ];
    const doc: ReaderDocument = { id: 'streamed', title: 'Streamed', kind: 'PDF', segments, pageCount: 3, position: 0, bookmarks: [], created: 0, updated: 0 };
    const at = segments[0].text.indexOf('café'), source = documentSpeechSource(doc, 0, at + 1), expected = documentSpeechPlan(doc, 0, at + 1), actual = [];
    for (let index = 0; source.get(index); index++) actual.push(source.get(index));
    expect(actual).toEqual(expected);
    expect(actual[0]?.text).toBe('café readers and finish the complete sentence here.');
    expect(actual[0]?.parts).toEqual([{ segment: 0, start: at, end: segments[0].text.length, offset: 0 }, { segment: 2, start: 0, end: 34, offset: 17 }]);
    expect(source.length).toBe(expected.length);
  });
  it('keeps bounded prefixes final even when empty and omitted passages separate tiny headings', () => {
    const segments = [{ text: 'I', page: 1, heading: true }, { text: '', page: 1 }, { text: 'HEADER', page: 1 }, { text: 'A small start.', page: 2 }, { text: 'The remaining sentence is long enough to become its own speech unit.', page: 2 }];
    const plan = speechPlan(segments, 0, 0, Infinity, new Set([2]));
    expect(speechPlan(segments, 0, 0, 1, new Set([2]))).toEqual([plan[0]]);
    expect(plan[0].text).toBe('I\n\nA small start.');
    expect(speechPlan(segments, 0, 0, 0)).toEqual([]);
    expect(new SegmentQueue(iterateSpeech([], 0)).get(0)).toBeUndefined();
  });
  it('prepares only the opening phrases while preserving the full plan prefix', () => {
    const segments = Array.from({ length: 1000 }, (_, index) => ({ text: `Chapter ${index}\nA little time to settle in. This is a longer sentence that continues the thought and explains the next idea.`, page: index + 1 }));
    const full = speechPlan(segments);
    const opening = speechPlan(segments, 0, 0, 3);
    expect(opening).toEqual(full.slice(0, 3));
  });
  it('starts at the exact clicked word and continues without repeating or losing text', () => {
    const text = 'Before this point, listen carefully to the story. Then continue into the next sentence.';
    const segments = [{ text, page: 1 }, { text: 'The next paragraph follows naturally.', page: 1 }];
    const at = text.indexOf('carefully');
    const plan = speechPlan(segments, 0, at + 2);
    expect(plan[0].text.startsWith('carefully')).toBe(true);
    expect(plan.map(chunk => chunk.text).join(' ').replace(/\s+/g, ' ')).toBe(`${text.slice(at)} ${segments[1].text}`);
    expect(chunkPosition(plan[0], 0, segments)).toEqual({ index: 0, fraction: at / text.length });
    expect(chunkPosition(plan.at(-1)!, 1, segments)).toEqual({ index: 1, fraction: 1 });
  });
  it('keeps chunks bounded and preserves all content in a long sentence', () => {
    const text = 'A long sentence has ' + 'many interesting and carefully chosen words, '.repeat(20) + 'and finally ends.';
    const plan = speechPlan([{ text, page: 1 }]);
    expect(plan).toHaveLength(1);
    expect(plan.map(chunk => chunk.text).join(' ')).toBe(text);
  });
  it('does not stop mid sentence at the old 110/180 character budgets', () => {
    const text = "Charlie's formal education began at Dundee Elementary School where he and his younger sisters, Nancy and Carol, were indoctrinated with ethical homilies.";
    expect(speechPlan([{ text, page: 10 }]).map(chunk => chunk.text)).toEqual([text]);
  });
  it('joins a sentence continued on the next PDF page and maps the clicked word', () => {
    const segments = [{ text: 'This sentence continues for quite a while before the page ends and then', page: 1 }, { text: 'finishes on the following page. Another sentence follows.', page: 2 }];
    const plan = speechPlan(segments);
    expect(plan[0].text).toBe(segments[0].text + ' finishes on the following page.');
    expect(chunkPosition(plan[0], 1, segments)).toEqual({ index: 1, fraction: 'finishes on the following page.'.length / segments[1].text.length });
    expect(speechPlan(segments, 1, segments[1].text.indexOf('following') + 2)[0].text.startsWith('following page.')).toBe(true);
    expect(speechPlan(segments, 0, segments[0].text.indexOf('then'))[0].text).toBe('then finishes on the following page.');
  });
  it('keeps titles, initials, decimal numbers and closing quotes with their sentence', () => {
    const text = 'Dr. Davis met Mr. Jones at 3.14 on the chart. “That is right,” he said. A. Smith agreed.';
    expect(speechPlan([{ text, page: 1 }]).map(chunk => chunk.text)).toEqual(['Dr. Davis met Mr. Jones at 3.14 on the chart.', '“That is right,” he said.', 'A. Smith agreed.']);
  });
  it('bounds enormous sentences for IPC without omitting or repeating words', () => {
    const text = 'A sentence with ' + 'many words and a useful clause, '.repeat(150) + 'the end.';
    const plan = speechPlan([{ text, page: 1 }]);
    expect(plan.every(chunk => chunk.text.length <= 1600)).toBe(true);
    expect(plan.map(chunk => chunk.text).join(' ')).toBe(text);
  });
  it('joins tiny headings to give generation runway and maps paragraph progress', () => {
    const segments = [{ text: 'Chapter one', page: 1, heading: true }, { text: 'A small beginning.', page: 1 }, { text: 'The story continues with many more words.', page: 1 }];
    const plan = speechPlan(segments);
    expect(plan[0].parts.length).toBeGreaterThan(1);
    expect(plan[0].text.startsWith('Chapter one\n\nA small beginning.')).toBe(true);
    expect(chunkPosition(plan[0], 0, segments).index).toBe(0);
    expect(chunkPosition(plan[0], 1, segments).index).toBe(1);
  });
  it('never concatenates numbered headings with the following paragraph as a run-on sentence', () => {
    const segments = [
      { text: '2. Check the money on three real orders', page: 2, heading: false },
      { text: 'For three recent completed orders, if available, write down the amount collected, product costs, delivery, installation, discounts and other order costs. Calculate what you actually kept.', page: 2, heading: false }
    ];
    const plan = speechPlan(segments);
    expect(plan.map(chunk => chunk.text)).toEqual([
      '2. Check the money on three real orders',
      'For three recent completed orders, if available, write down the amount collected, product costs, delivery, installation, discounts and other order costs.',
      'Calculate what you actually kept.'
    ]);
  });
  it('handles punctuation, apostrophes, unicode and final words', () => {
    expect(wordStart('Don’t stop café readers.', 3)).toBe(0);
    const segments = [{ text: 'Don’t stop café readers.', page: 1 }];
    expect(speechPlan(segments, 0, 16)[0].text).toBe('readers.');
    expect(speechPlan(segments, 0, segments[0].text.length)).toEqual([]);
  });
});

describe('PDF word coordinates', () => {
  it('highlights only the scheduled sentence suffix across split PDF runs and omitted margins', () => {
    const text = 'Before this point, listen carefully. The next sentence stays clear.';
    const segments = [{ text, page: 2 }];
    const runs = ['RUNNING HEADER', 'Before this point, ', 'listen carefully. ', 'The next sentence stays clear.'];
    const positions = mapPdfText(runs, segments, 2), parts = speechPlan(segments, 0, text.indexOf('listen'))[0].parts;
    expect(positions.map(map => pdfSpeechRanges(map, parts))).toEqual([[], [], [{ start: 0, end: 17 }], []]);
    const all = speechPlan(segments)[0].parts;
    expect(pdfSpeechRanges(positions[1], all)).toEqual([{ start: 0, end: 18 }]);
    expect(pdfSpeechRanges(positions[2], all)).toEqual([{ start: 0, end: 17 }]);
  });
  it('limits cross-page sentence highlighting to the mapped page without changing word mappings', () => {
    const segments = [{ text: 'A longer sentence continues over the page and', page: 1 }, { text: 'finishes here. Another sentence follows on this page.', page: 2 }];
    const parts = speechPlan(segments)[0].parts, map = mapPdfText([segments[1].text], segments, 2)[0];
    expect(pdfSpeechRanges(map, parts)).toEqual([{ start: 0, end: 14 }]);
    expect(pdfSpeechRanges(map, [])).toEqual([]);
    expect(map[15]).toEqual({ index: 1, character: 15 });
  });
  it('maps split runs and repeated words across passages to the right source word', () => {
    const segments = [{ text: 'Other page.', page: 1 }, { text: 'Read this story.', page: 2 }, { text: 'Read this again.', page: 2 }];
    const mapped = mapPdfText(['Read ', 'this story.', 'Read this again.'], segments, 2);
    expect(mapped[0][1]).toEqual({ index: 1, character: 0 });
    expect(mapped[1][6]).toEqual({ index: 1, character: 10 });
    expect(mapped[2][11]).toEqual({ index: 2, character: 10 });
  });
  it('does not invent a position for text absent from the extracted document', () => {
    expect(mapPdfText(['absent'], [{ text: 'Present.', page: 1 }], 1)).toEqual([[]]);
  });
});
