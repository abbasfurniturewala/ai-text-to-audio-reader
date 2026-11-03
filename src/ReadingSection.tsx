import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Bookmark, FileText, Volume2 } from 'lucide-react';
import WordText from './WordText';
import type { Segment } from './types';
import type { DocumentLocation } from './locations';

interface Props {
  location: DocumentLocation; segments: Segment[]; pdf: boolean; count: number;
  position: number; bookmarks: number[]; search: string; disabled: boolean;
  force: boolean; fontSize: number; fontTheme: string;
  activeRef: RefObject<HTMLButtonElement | null>;
  onRead(index: number, character: number): void;
  onOriginal(page: number): void;
}

/** Keep the page landmarks, but mount words only around the viewport (plus the
 * audio/jump target). Measured placeholders keep scrolling stable on eviction. */
export default memo(function ReadingSection(props: Props) {
  const { location, segments, pdf, count, position, bookmarks, search, disabled, force, fontSize, fontTheme, activeRef, onRead, onOriginal } = props;
  const section = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [nearby, setNearby] = useState(location.number === 1);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const visible = nearby || force;
  const matching = useMemo(() => segments.slice(location.start, location.end).map((segment, offset) => ({ segment, index: location.start + offset }))
    .filter(({ segment }) => !search || segment.text.toLowerCase().includes(search.toLowerCase())), [segments, location, search]);
  const estimated = useMemo(() => matching.reduce((height, { segment }) => height + Math.ceil(segment.text.length / Math.max(12, (size.width || 450) / (fontSize * .5))) * fontSize * 1.95 + 30, 0) || 160, [matching, size.width, fontSize, fontTheme]);
  useEffect(() => {
    const element = section.current;
    if (!element) return;
    const observer = new IntersectionObserver(entries => setNearby(entries[0].isIntersecting), { root: element.closest('.reader-scroll'), rootMargin: '1200px 0px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [search]);
  useLayoutEffect(() => {
    if (!visible || !content.current) return;
    const element = content.current;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      setSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, [visible, search, fontSize, fontTheme]);
  if (search && !matching.length) return null;
  return <section ref={section} className="reading-page-section" data-location-key={location.key} data-mounted={visible} aria-label={pdf ? `Original PDF page ${location.page}` : `Document section ${location.number}`}>
    <h2 className="original-page-marker"><span>{pdf ? location.title : `Section ${location.number}`}</span><small>{pdf ? `ORIGINAL PDF · ${location.number} OF ${count}` : `${location.start + 1}–${location.end} · PASSAGES`}</small></h2>
    <div ref={content} className="section-content" style={visible ? undefined : { height: size.height || estimated }}>
      {visible && <>
        {location.start === location.end && <div className="unreadable-page"><FileText size={24} /><p>This page has no selectable text.</p><button className="text-button" onClick={() => onOriginal(location.page)}>View original page</button></div>}
        {matching.map(({ segment, index }) => <button ref={index === position ? activeRef : undefined} key={index} data-passage-index={index} className={`passage ${segment.heading ? 'passage-heading' : ''} ${index === position ? 'current-passage' : ''}`} disabled={disabled} onClick={event => {
          if (window.getSelection()?.toString()) return;
          const word = (event.target as HTMLElement).closest<HTMLElement>('[data-word-start]');
          onRead(index, Number(word?.dataset.wordStart) || 0);
        }} aria-label={`Read from passage ${index + 1}: ${segment.text.slice(0, 75)}`} aria-current={index === position ? 'true' : undefined}>
          {index === position && <span className="passage-indicator"><Volume2 size={15} /></span>}
          <WordText text={segment.text} search={search} />
          {bookmarks.includes(index) && <Bookmark className="passage-bookmark" size={12} fill="currentColor" />}
        </button>)}
      </>}
    </div>
  </section>;
});
