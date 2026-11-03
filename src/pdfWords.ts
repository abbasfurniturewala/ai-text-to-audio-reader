import type { Segment } from './types';
import { wordStart } from './speechPlan';

/** PDF text runs and reading passages differ in whitespace, but retain character order. */
export function mapPdfText(runs: string[], segments: Segment[], page: number) {
  const characters: string[] = [], positions: Array<{ index: number; character: number }> = [];
  segments.forEach((segment, index) => {
    if (segment.page !== page) return;
    for (let character = 0; character < segment.text.length; character++) {
      if (/[\s\u0000]/u.test(segment.text[character])) continue;
      characters.push(segment.text[character]); positions.push({ index, character });
    }
  });
  const source = characters.join('');
  let cursor = 0;
  return runs.map(run => {
    const normalized = run.replace(/[\s\u0000]/gu, '');
    const begin = source.indexOf(normalized, cursor);
    const mapped: Array<{ index: number; character: number } | undefined> = [];
    if (!normalized || begin < 0) return mapped;
    let at = begin;
    for (let i = 0; i < run.length; i++) {
      if (/[\s\u0000]/u.test(run[i])) { mapped.push(undefined); continue; }
      const position = positions[at++];
      mapped.push({ index: position.index, character: wordStart(segments[position.index].text, position.character) });
    }
    cursor = at;
    return mapped;
  });
}
