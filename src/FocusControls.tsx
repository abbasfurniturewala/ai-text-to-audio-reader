import { AudioLines, BookOpen, Bookmark, ChevronLeft, ChevronRight, FileText, Headphones, Highlighter, List, LoaderCircle, LocateFixed, Minimize2, Moon, Pause, Play, Search, Underline } from 'lucide-react';

interface Props {
  playing: boolean; busy: boolean; disabled: boolean;
  page: number; count: number; pdf: boolean; original: boolean;
  speed: number; voiceOpen: boolean; navigationOpen: boolean; bookmarked: boolean;
  speechCue: 'highlight' | 'underline'; onSpeechCue(cue: 'highlight' | 'underline'): void;
  pdfZoom: number; onPdfZoom(zoom: number): void; canBookmark: boolean;
  pdfNight?: boolean; onPdfNight?(): void;
  searchOpen: boolean; onSearch(): void;
  followAudio: boolean; onFollow(): void;
  onExit(): void; onToggle(): void; onSkip(seconds: number): void;
  onPage(page: number): void; onNavigate(): void; onVoice(): void;
  onSpeed(speed: number): void; onOriginal(): void; onBookmark(): void; onAudio(): void;
}

export default function FocusControls(props: Props) {
  return <aside className="focus-controls" aria-label="Full screen reading controls">
    <button className="icon-button" aria-label="Exit full screen" title="Exit full screen · Esc / F11" onClick={props.onExit}><Minimize2 size={17} /></button>
    <span className="focus-divider" />
    <button className="focus-play" aria-label={props.busy ? 'Cancel loading' : props.playing ? 'Pause narration' : 'Play narration'} title="Play / pause · Space" disabled={props.disabled} onClick={props.onToggle}>{props.busy ? <LoaderCircle size={19} className="spin" /> : props.playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button>
    <div className="focus-skip"><button aria-label="Back 15 seconds" title="Back 15 seconds" disabled={props.disabled} onClick={() => props.onSkip(-15)}>↶<small>15</small></button><button aria-label="Forward 15 seconds" title="Forward 15 seconds" disabled={props.disabled} onClick={() => props.onSkip(15)}>↷<small>15</small></button></div>
    <button className="icon-button" aria-label="Go to audio" title="Go to audio" onClick={props.onAudio}><Headphones size={17} /></button>
    <button className={`icon-button ${props.followAudio ? 'following' : ''}`} aria-label="Follow audio" aria-pressed={props.followAudio} title="Follow audio · scroll with narration" onClick={props.onFollow}><LocateFixed size={17} /></button>
    <span className="focus-divider" />
    <button className="focus-page" aria-label={`Viewing ${props.pdf ? 'page' : 'section'} ${props.page} of ${props.count}; open navigation`} title="Open document navigation" onClick={props.onNavigate}><b>{props.page}</b><small>/ {props.count}</small></button>
    <div className="focus-page-step"><button className="icon-button" aria-label={props.pdf ? 'Previous document page' : 'Previous section'} disabled={props.page <= 1} onClick={() => props.onPage(props.page - 1)}><ChevronLeft size={15} /></button><button className="icon-button" aria-label={props.pdf ? 'Next document page' : 'Next section'} disabled={props.page >= props.count} onClick={() => props.onPage(props.page + 1)}><ChevronRight size={15} /></button></div>
    <button className="icon-button" aria-label="Document navigation" aria-expanded={props.navigationOpen} aria-controls="document-navigation" title="Document navigation" onClick={props.onNavigate}><List size={17} /></button>
    <button className="icon-button" aria-label={props.voiceOpen ? 'Hide voice panel' : 'Show voice panel'} aria-expanded={props.voiceOpen} aria-controls="voice-panel" title="Choose a voice" onClick={props.onVoice}><AudioLines size={18} /></button>
    <label className="focus-speed" title="Narration speed"><select aria-label="Narration speed" value={props.speed} onChange={event => props.onSpeed(Number(event.target.value))}>{Array.from({ length: 23 }, (_, index) => Math.round((.65 + index * .05) * 100) / 100).map(value => <option key={value} value={value}>{value.toFixed(2).replace(/0$/, '')}×</option>)}</select></label>
    <button className="icon-button" aria-label={props.original ? 'Switch to reading view' : 'Switch to document view'} title={props.original ? 'Reading view' : 'Document view'} onClick={props.onOriginal}>{props.original ? <BookOpen size={17} /> : <FileText size={17} />}</button>
    <button className="icon-button" aria-label="Search document" aria-expanded={props.searchOpen} title="Search document" onClick={props.onSearch}><Search size={17} /></button>
    {props.pdf && props.original && <label className="focus-speed" title="PDF zoom"><select aria-label="PDF zoom" value={props.pdfZoom} onChange={event => props.onPdfZoom(Number(event.target.value))}>{[.5,.75,1,1.25,1.5,1.75,2].map(value => <option key={value} value={value}>{value === 1 ? 'Fit' : `${Math.round(value * 100)}%`}</option>)}</select></label>}
    {props.pdf && props.original && props.onPdfNight && <button className={`icon-button ${props.pdfNight ? 'following' : ''}`} aria-label="Night PDF page" aria-pressed={props.pdfNight} title={props.pdfNight ? 'Original PDF page' : 'Night PDF page'} onClick={props.onPdfNight}><Moon size={17} /></button>}
    <button className="icon-button" aria-label={`Speech cue: ${props.speechCue}; switch to ${props.speechCue === 'highlight' ? 'underline' : 'highlight'}`} title={`Speech cue: ${props.speechCue === 'highlight' ? 'Highlight' : 'Underline'}`} onClick={() => props.onSpeechCue(props.speechCue === 'highlight' ? 'underline' : 'highlight')}>{props.speechCue === 'highlight' ? <Highlighter size={17} /> : <Underline size={17} />}</button>
    <button className={`icon-button ${props.bookmarked ? 'is-bookmarked' : ''}`} aria-label={props.bookmarked ? 'Remove bookmark' : 'Bookmark viewed passage'} title="Bookmark the viewed passage" disabled={!props.canBookmark} onClick={props.onBookmark}><Bookmark size={17} fill={props.bookmarked ? 'currentColor' : 'none'} /></button>
  </aside>;
}
