import { describe, expect, it } from 'vitest';
import { speechPlan, chunkPosition, wordStart } from '../src/speechPlan';
import { mapPdfText } from '../src/pdfWords';

describe('sentence planning', () => {
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
  it('handles punctuation, apostrophes, unicode and final words', () => {
    expect(wordStart('Don’t stop café readers.', 3)).toBe(0);
    const segments = [{ text: 'Don’t stop café readers.', page: 1 }];
    expect(speechPlan(segments, 0, 16)[0].text).toBe('readers.');
    expect(speechPlan(segments, 0, segments[0].text.length)).toEqual([]);
  });
});

describe('PDF word coordinates', () => {
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
