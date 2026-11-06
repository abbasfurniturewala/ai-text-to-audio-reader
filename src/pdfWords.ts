import type { Segment } from './types';
import { wordStart, type SpeechPart } from './speechPlan';

/** Highlight mapped source text without changing the PDF.js text layer or word clicks. */
export function pdfSpeechRanges(positions: Array<{ index: number; character: number } | undefined>, parts: SpeechPart[]) {
  const ranges: Array<{ start: number; end: number }> = [];
  let start = -1, end = 0;
  const flush = () => { if (start >= 0) ranges.push({ start, end }); start = -1; };
  positions.forEach((position, at) => {
    if (!position) return;
    if (parts.some(part => part.segment === position.index && position.character >= part.start && position.character < part.end)) {
      if (start < 0) start = at;
      end = at + 1;
    } else flush();
  });
  flush();
  return ranges;
}

/** PDF text runs and reading passages differ in whitespace, but retain character order. */
export function mapPdfText(runs: string[], segments: Segment[], page: number, exact = false) {
  const characters: string[] = [], positions: Array<{ index: number; character: number }> = [];
  segments.forEach((segment, index) => {
    if (segment.page !== page) return;
    for (let character = 0; character < segment.text.length; character++) {
      if (/[\s\u0000]/u.test(segment.text[character])) continue;
      characters.push(segment.text[character]); positions.push({ index, character });
    }
  });
  const source = characters.join('');
  const normalizedRuns = runs.map(run => run.replace(/[\s\u0000]/gu, '')), nextRuns: string[] = [];
  let following = '';
  for (let i = runs.length - 1; i >= 0; i--) { nextRuns[i] = following; if (normalizedRuns[i]) following = normalizedRuns[i]; }
  let cursor = 0;
  return runs.map((run, index) => {
    const normalized = normalizedRuns[index];
    const begin = source.indexOf(normalized, cursor);
    const mapped: Array<{ index: number; character: number } | undefined> = [];
    if (!normalized || begin < 0 || (normalized.length <= 4 && begin - cursor > 40)) return mapped;
    const following = nextRuns[index];
    const anchor = following.length > normalized.length ? source.indexOf(following, cursor) : -1;
    if (anchor >= cursor && anchor < begin + normalized.length) return mapped;
    let at = begin;
    for (let i = 0; i < run.length; i++) {
      if (/[\s\u0000]/u.test(run[i])) { mapped.push(undefined); continue; }
      const position = positions[at++];
      mapped.push({ index: position.index, character: exact ? position.character : wordStart(segments[position.index].text, position.character) });
    }
    cursor = at;
    return mapped;
  });
}
