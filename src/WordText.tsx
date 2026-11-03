import { memo } from 'react';

/** Keep the exact source offsets even when a search match crosses word boundaries. */
export default memo(function WordText({ text, search = '' }: { text: string; search?: string }) {
  const matches: Array<[number, number]> = [];
  if (search) {
    const lower = text.toLowerCase(), needle = search.toLowerCase();
    for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + needle.length)) matches.push([at, at + needle.length]);
  }
  return <>{Array.from(new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text), item => {
    const start = item.index, end = start + item.segment.length;
    const boundaries = [start, ...matches.flatMap(([a, b]) => [a, b]).filter(at => at > start && at < end), end].sort((a, b) => a - b);
    const content = boundaries.slice(0, -1).map((at, i) => {
      const part = text.slice(at, boundaries[i + 1]);
      return matches.some(([a, b]) => at >= a && at < b) ? <mark key={at}>{part}</mark> : part;
    });
    return item.isWordLike ? <span key={start} className="read-word" data-word-start={start} title={`Listen from “${item.segment}”`}>{content}</span> : <span key={start}>{content}</span>;
  })}</>;
});
