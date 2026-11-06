import { memo, useEffect, useRef, useState, type RefObject } from 'react';
import { Bookmark, Volume2 } from 'lucide-react';
import WordText from './WordText';
import { observeReader } from './readerVisibility';
import { clearReaderHover, moveReaderHover, readerWordAt } from './readerText';
import type { Segment } from './types';

interface Props {
  segment: Segment; index: number; current: boolean; target: boolean; bookmarked: boolean;
  search: string; disabled: boolean; spokenStart?: number; spokenEnd?: number;
  activeRef: RefObject<HTMLButtonElement | null>;
  onRead(index: number, character: number): void;
}

export default memo(function ReadingPassage({ segment, index, current, target, bookmarked, search, disabled, spokenStart = -1, spokenEnd = -1, activeRef, onRead }: Props) {
  const button = useRef<HTMLButtonElement>(null), [nearby, setNearby] = useState(false);
  const words = nearby || current || target || spokenStart >= 0;
  useEffect(() => {
    const element = button.current;
    if (!element) return;
    let unpin = () => {};
    const selected = () => { const selection = window.getSelection(); return !!selection && !selection.isCollapsed && Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index)).some(range => range.intersectsNode(element)); };
    const disconnect = observeReader(element, near => {
      unpin();
      if (!near && selected()) {
        // Keep the real selection nodes until copying/selection has finished.
        const release = () => { if (!selected()) { unpin(); setNearby(false); } };
        document.addEventListener('selectionchange', release); unpin = () => document.removeEventListener('selectionchange', release);
      } else setNearby(near);
    });
    return () => { disconnect(); unpin(); clearReaderHover(element); };
  }, []);
  return <button ref={element => { button.current = element; if (current) activeRef.current = element; }} data-passage-index={index} data-text-mounted={words} className={`passage ${segment.heading ? 'passage-heading' : ''} ${current ? 'current-passage' : ''}`} disabled={disabled} onPointerMove={event => { if (disabled || event.buttons || window.getSelection()?.toString()) clearReaderHover(); else moveReaderHover(event.currentTarget, segment.text, event.clientX, event.clientY); }} onPointerLeave={event => clearReaderHover(event.currentTarget)} onClick={event => {
    if (window.getSelection()?.toString()) return;
    if (event.detail > 0) event.currentTarget.blur();
    const word = (event.target as HTMLElement).closest<HTMLElement>('[data-word-start]');
    const character = word ? Number(word.dataset.wordStart) || 0 : event.detail > 0 ? readerWordAt(event.currentTarget, segment.text, event.clientX, event.clientY)?.start || 0 : 0;
    onRead(index, character);
  }} aria-label={`Read from passage ${index + 1}: ${segment.text.slice(0, 75)}`} aria-current={current ? 'true' : undefined}>
    {current && <span className="passage-indicator"><Volume2 size={15} /></span>}
    {words ? <WordText text={segment.text} search={search} spokenStart={spokenStart} spokenEnd={spokenEnd} /> : segment.text}
    {bookmarked && <Bookmark className="passage-bookmark" size={12} fill="currentColor" />}
  </button>;
});
