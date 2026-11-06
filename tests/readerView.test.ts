import { describe, expect, it } from 'vitest';
import { readerMatches } from '../src/readerView';
import { mapPdfText, pdfSpeechRanges } from '../src/pdfWords';

describe('document search source positions', () => {
  it('finds literal, case-insensitive matches with exact Unicode source offsets', () => {
    expect(readerMatches([{ text: 'Café (A+B). café (a+b).', page: 7 }], '(a+b)')).toEqual([
      { segment: 0, start: 5, end: 10, page: 7 }, { segment: 0, start: 17, end: 22, page: 7 },
    ]);
    expect(readerMatches([{ text: 'Some readable text.', page: 1 }], '   ')).toEqual([]);
  });
  it('bounds results while retaining document order and real PDF page numbers', () => {
    const segments = [{ text: 'word word', page: 2 }, { text: 'WORD word', page: 5 }];
    expect(readerMatches(segments, 'word', 3)).toEqual([
      { segment: 0, start: 0, end: 4, page: 2 }, { segment: 0, start: 5, end: 9, page: 2 }, { segment: 1, start: 0, end: 4, page: 5 },
    ]);
  });
  it('maps a partial-word PDF search without broadening it to an entire source word', () => {
    const segments = [{ text: 'carefully chosen text', page: 1 }];
    const match = readerMatches(segments, 'fully')[0];
    const positions = mapPdfText(['carefully ', 'chosen text'], segments, 1, true);
    expect(pdfSpeechRanges(positions[0], [{ ...match, offset: 0 }])).toEqual([{ start: 4, end: 9 }]);
    expect(positions[0][6]).toEqual({ index: 0, character: 6 });
    expect(mapPdfText(['carefully'], segments, 1)[0][6]).toEqual({ index: 0, character: 0 });
  });
});
