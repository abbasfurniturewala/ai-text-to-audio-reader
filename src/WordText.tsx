import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import { wordSegments } from './textSegments';
import { nativeTextRanges, readerRange, setReaderRanges } from './readerText';

interface Props { text: string; search?: string; spokenStart?: number; spokenEnd?: number }

/** Native text keeps one accessible text run instead of thousands of inline
 * boxes. Highlight ranges never replace the user's selection or source nodes. */
export default memo(function WordText(props: Props) { return nativeTextRanges() ? <RangeText {...props} /> : <TokenText {...props} />; });
function RangeText({ text, search = '', spokenStart = -1, spokenEnd = -1 }: Props) {
  const span = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const element = span.current;
    if (!element) return;
    const speech: Range[] = [], matches: Range[] = [];
    const spoken = readerRange(element, spokenStart, Math.min(text.length, spokenEnd));
    if (spoken) speech.push(spoken);
    if (search) {
      const lower = text.toLowerCase(), needle = search.toLowerCase();
      for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + needle.length)) { const range = readerRange(element, at, Math.min(text.length, at + needle.length)); if (range) matches.push(range); }
    }
    setReaderRanges(element, speech, matches);
    return () => setReaderRanges(element);
  }, [text, search, spokenStart, spokenEnd]);
  return <span ref={span} className="reader-text" data-reader-text="">{text}</span>;
}

/** Keep the exact source offsets even when a search match crosses word boundaries. */
function TokenText({ text, search = '', spokenStart = -1, spokenEnd = -1 }: Props) {
  const words = useMemo(() => Array.from(wordSegments(text)), [text]);
  const matches: Array<[number, number]> = [];
  if (search) {
    const lower = text.toLowerCase(), needle = search.toLowerCase();
    for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + needle.length)) matches.push([at, at + needle.length]);
  }
  return <>{words.map(item => {
    const start = item.index, end = start + item.segment.length;
    const boundaries = [start, ...matches.flatMap(([a, b]) => [a, b]).filter(at => at > start && at < end), end].sort((a, b) => a - b);
    const content = boundaries.slice(0, -1).map((at, i) => {
      const part = text.slice(at, boundaries[i + 1]);
      return matches.some(([a, b]) => at >= a && at < b) ? <mark key={at}>{part}</mark> : part;
    });
    const spoken = start < spokenEnd && end > spokenStart ? 'spoken-text' : '';
    return item.isWordLike ? <span key={start} className={`read-word ${spoken}`} data-word-start={start} title={`Listen from “${item.segment}”`}>{content}</span> : <span key={start} className={spoken || undefined}>{content}</span>;
  })}</>;
}
