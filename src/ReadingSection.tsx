import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { FileText } from 'lucide-react';
import ReadingPassage from './ReadingPassage';
import { observeReader } from './readerVisibility';
import type { Segment } from './types';
import type { DocumentLocation } from './locations';
import type { SpeechPart } from './speechPlan';

interface Props {
  location: DocumentLocation; segments: Segment[]; pdf: boolean; count: number;
  position: number; bookmarks: number[]; search: string; filter?: boolean; disabled: boolean;
  force: boolean; target?: number; fontSize: number; fontTheme: string;
  spokenParts?: SpeechPart[];
  activeRef: RefObject<HTMLButtonElement | null>;
  onRead(index: number, character: number): void;
  onOriginal(page: number): void;
}

/** Keep the page landmarks, but mount words only around the viewport (plus the
 * audio/jump target). Measured placeholders keep scrolling stable on eviction. */
export default memo(function ReadingSection(props: Props) {
  const { location, segments, pdf, count, position, bookmarks, search, filter = true, disabled, force, target, fontSize, fontTheme, spokenParts, activeRef, onRead, onOriginal } = props;
  const section = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [nearby, setNearby] = useState(location.number === 1);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const visible = nearby || force;
  const matching = useMemo(() => segments.slice(location.start, location.end).map((segment, offset) => ({ segment, index: location.start + offset }))
    .filter(({ segment }) => !search || !filter || segment.text.toLowerCase().includes(search.toLowerCase())), [segments, location, search, filter]);
  const estimated = useMemo(() => matching.reduce((height, { segment }) => height + Math.ceil(segment.text.length / Math.max(12, (size.width || 450) / (fontSize * .5))) * fontSize * 1.95 + 30, 0) || 160, [matching, size.width, fontSize, fontTheme]);
  useEffect(() => {
    const element = section.current;
    if (!element) return;
    return observeReader(element, setNearby);
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
        {matching.map(({ segment, index }) => <ReadingPassage key={index} segment={segment} index={index} current={index === position} target={index === target} bookmarked={bookmarks.includes(index)} search={search} disabled={disabled} spokenStart={spokenParts?.find(part => part.segment === index)?.start} spokenEnd={spokenParts?.filter(part => part.segment === index).at(-1)?.end} activeRef={activeRef} onRead={onRead} />)}
      </>}
    </div>
  </section>;
});
