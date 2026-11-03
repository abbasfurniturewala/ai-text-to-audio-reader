import type { Segment } from './types';
import { endsSentence, isHeading } from './paragraphs';

export interface SpeechPart { segment: number; start: number; end: number; offset: number }
export interface SpeechChunk extends Segment { parts: SpeechPart[] }

/** Sentence boundaries are linguistic boundaries, not character budgets. */
export function sentenceRanges(text: string): { start: number; end: number }[] {
  const result: { start: number; end: number }[] = [];
  for (const sentence of new Intl.Segmenter('en', { granularity: 'sentence' }).segment(text)) {
    const previous = result.at(-1);
    const prevText = previous ? text.slice(previous.start, previous.end).trim() : '';
    // ICU can treat titles/initials or leading item numbers before a capitalized word as a sentence.
    if (previous && (/\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|e\.g|i\.e|[A-Z])\.$/i.test(prevText) || /^\d+(?:\.\d+)*\.$/.test(prevText))) previous.end = sentence.index + sentence.segment.trimEnd().length;
    else result.push({ start: sentence.index, end: sentence.index + sentence.segment.trimEnd().length });
  }
  return result;
}

/** Keep complete sentences (and their exact source positions). Only enormous
 * inputs need a transport bound; the worker checks the model's actual tokens. */
export function speechPlan(segments: Segment[], from = 0, character = 0, maxChunks = Infinity): SpeechChunk[] {
  const chunks: SpeechChunk[] = [];
  const nextContinues = (cur: Segment, next?: Segment) => Boolean(next && !cur.heading && !next.heading &&
    (/^[a-z]/.test(next.text.trim()) || (next.page !== cur.page && !isHeading(cur.text) && !isHeading(next.text))));
  for (let index = from; index < segments.length; index++) {
    const segment = segments[index];
    const sourceStart = index === from ? wordStart(segment.text, character) : 0;
    let combined = segment.text.slice(sourceStart);
    if (!combined.trim()) continue;
    const sources: SpeechPart[] = [{ segment: index, start: sourceStart, end: segment.text.length, offset: 0 }];
    // A PDF page turn (or an older extraction block) must not end a sentence.
    while (!endsSentence(combined) && nextContinues(segments[index], segments[index + 1]) && combined.length < 16000) {
      const next = segments[++index];
      sources.push({ segment: index, start: 0, end: next.text.length, offset: combined.length + 1 });
      combined += ' ' + next.text;
    }
    for (const range of sentenceRanges(combined)) {
      let start = range.start;
      while (start < range.end) {
        if (chunks.length > maxChunks) return chunks.slice(0, maxChunks);
        while (/\s/.test(combined[start] || '') && start < range.end) start++;
        if (start >= range.end) break;
        let end = range.end;
        if (end - start > 1600) {
          const prefix = combined.slice(start, start + 1600);
          const clause = [...prefix.matchAll(/[,;:—–]\s+/g)].filter(match => match.index > 300).at(-1);
          end = start + (clause ? clause.index + 1 : prefix.lastIndexOf(' ') > 0 ? prefix.lastIndexOf(' ') : 1600);
        }
        const text = combined.slice(start, end).trimEnd();
        const parts = sources.filter(part => part.offset < end && part.offset + part.end - part.start > start).map(part => {
          const overlap = Math.max(start, part.offset);
          return { segment: part.segment, start: part.start + overlap - part.offset,
            end: part.start + Math.min(end - part.offset, part.end - part.start), offset: overlap - start };
        });
        const previous = chunks.at(-1);
        // Give tiny headings enough runway without cutting the next sentence.
        if (previous && previous.text.length < 40 && (!endsSentence(previous.text) || previous.text.length < 16) && previous.text.length + text.length + 2 <= 180) {
          const separator = previous.parts.at(-1)!.segment === parts[0].segment ? ' ' : '\n\n';
          const offset = previous.text.length + separator.length;
          previous.text += separator + text;
          previous.parts.push(...parts.map(part => ({ ...part, offset: part.offset + offset })));
        } else {
          chunks.push({ text, page: segment.page, parts });
        }
        start = end;
      }
    }
  }
  return chunks.slice(0, maxChunks);
}

export function wordStart(text: string, character: number): number {
  const at = Math.max(0, Math.min(text.length, Math.floor(character) || 0));
  if (at === 0 || at === text.length) return at;
  for (const item of new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)) {
    if (item.index <= at && item.index + item.segment.length > at) return item.isWordLike ? item.index : at;
  }
  return at;
}

export function chunkPosition(chunk: SpeechChunk, fraction: number, segments: Segment[]) {
  const at = Math.max(0, Math.min(1, fraction)) * chunk.text.length;
  const part = [...chunk.parts].reverse().find(item => item.offset <= at) || chunk.parts[0];
  const character = part.start + Math.min(part.end - part.start, Math.max(0, at - part.offset));
  return { index: part.segment, fraction: character / Math.max(1, segments[part.segment].text.length) };
}
