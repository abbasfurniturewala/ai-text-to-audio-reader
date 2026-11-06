import { describe, expect, it } from 'vitest';
import { pcm16, wavBytes, wavBytesFromInt16Chunks } from '../src/audio';
import { speechClipBounds } from '../src/narration';
import { refreshHeadings } from '../src/library';
import { pdfMarginCandidates, pdfSpeechOmissions, stripPdfRunningHeaders } from '../src/pdfMargins';
import { speechPlan } from '../src/speechPlan';
import { mapPdfText } from '../src/pdfWords';
import { availableVoices, findVoice, localVoices } from '../src/voices';

describe('listening improvements', () => {
  it('preserves explicit DOCX paragraph semantics and refreshes inferred PDF headings', () => {
    const segments = [{ text: 'Why did you leave?', page: 1, heading: false }, { text: '2. Check the money on three real orders', page: 1, heading: false }, { text: 'For three recent orders, check the totals.', page: 1, heading: false }];
    expect(refreshHeadings(segments)[0].heading).toBe(false);
    expect(refreshHeadings(segments, true)[0].heading).toBe(false);
    expect(refreshHeadings(segments, true)[1].heading).toBe(true);
    expect(segments[1].heading).toBe(false);
  });
  it('produces identical PCM bytes from chunks without a merged Float32 copy', () => {
    const first = new Float32Array([-2, -.3, 0]), second = new Float32Array([.4, 1, 2]);
    expect(wavBytesFromInt16Chunks([pcm16(first), pcm16(second)], 24000)).toEqual(wavBytes(new Float32Array([...first, ...second]), 24000));
    expect(wavBytesFromInt16Chunks([], 24000)).toHaveLength(44);
  });
  it('uses the same natural bounds for heading, sentence and paragraph export', () => {
    const samples = new Float32Array(48000); samples.fill(.1, 4800, 28800);
    const heading = { text: 'A heading', page: 1, heading: true, parts: [{ segment: 0 }] };
    const paragraph = { text: 'A paragraph.', page: 1, heading: false, parts: [{ segment: 1 }] };
    expect(speechClipBounds(samples, 24000, heading, paragraph).duration).toBeCloseTo(1.74);
    expect(speechClipBounds(samples, 24000, paragraph).duration).toBeCloseTo(1.64);
    expect(speechClipBounds(samples, 24000, paragraph, paragraph).duration).toBeCloseTo(1.52);
  });
  it('removes repeated geometric PDF margins without removing body numbers or real chapter titles', () => {
    const body = 'This is a sufficiently long paragraph about the history of a careful experiment, whose explanation continues beyond the end of this printed page and';
    const pages = [1, 2, 3].map(page => ({ page, segments: [{ text: 'BOOK TITLE', page, heading: true }, { text: page === 1 ? body : 'finishes on the next page.', page, heading: false }, { text: String(page), page }], margins: [{ text: 'BOOK TITLE', zone: 'top' as const }, { text: String(page), zone: 'bottom' as const }] }));
    const filtered = stripPdfRunningHeaders(pages);
    expect(filtered.map(segment => segment.text)).toEqual([body, 'finishes on the next page.', 'finishes on the next page.']);
    expect(speechPlan(filtered)[0].text).toBe(body + ' finishes on the next page.');
    expect(pages[0].segments).toHaveLength(3);
    const ordinary = [{ page: 1, segments: [{ text: 'civil', page: 1 }], margins: [{ text: 'civil', zone: 'top' as const }] }];
    expect(stripPdfRunningHeaders(ordinary)[0].text).toBe('civil');
    expect(pdfMarginCandidates([{ str: 'A real heading', height: 24, width: 200, transform: [1, 0, 0, 1, 50, 700] }], 792)).toEqual([]);
  });
  it('skips old PDF edge passages without changing saved source indices', () => {
    const segments = [1, 2, 3].flatMap(page => [{ text: 'BOOK TITLE', page }, { text: 'A complete body sentence.', page }, { text: String(page), page }]);
    const skipped = pdfSpeechOmissions(segments);
    expect([...skipped]).toEqual(expect.arrayContaining([2, 3, 5, 6, 8]));
    expect(skipped.has(1)).toBe(false); expect(segments).toHaveLength(9);
  });
  it('does not map a removed short PDF margin into a distant body digit', () => {
    const text = 'This body contains enough words before the example number 2 appears.';
    const mapped = mapPdfText(['2', text], [{ text, page: 1 }], 1);
    expect(mapped[0]).toEqual([]); expect(mapped[1][0]).toEqual({ index: 0, character: 0 });
    const near = mapPdfText(['2', 'Read 2 books.'], [{ text: 'Read 2 books.', page: 1 }], 1);
    expect(near[0]).toEqual([]); expect(near[1][0]).toEqual({ index: 0, character: 0 });
  });
  it('keeps the eight curated voices while resolving extended voices and validated blends', () => {
    expect(localVoices).toHaveLength(8); expect(availableVoices).toHaveLength(23);
    expect(findVoice('af_kore')?.name).toBe('Kore');
    expect(findVoice('blend_af_heart_bf_emma_65')?.name).toBe('Heart + Emma');
    expect(findVoice('blend_af_heart_bf_emma_101')).toBeUndefined();
  });
});
