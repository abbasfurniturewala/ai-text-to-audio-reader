import { AudioLines, BookOpen, Bookmark, ChevronLeft, ChevronRight, FileText, Headphones, List, LoaderCircle, Minimize2, Pause, Play } from 'lucide-react';

interface Props {
  playing: boolean; busy: boolean; disabled: boolean;
  page: number; count: number; pdf: boolean; original: boolean;
  speed: number; voiceOpen: boolean; navigationOpen: boolean; bookmarked: boolean;
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
    <span className="focus-divider" />
    <button className="focus-page" aria-label={`Viewing ${props.pdf ? 'page' : 'section'} ${props.page} of ${props.count}; open navigation`} title="Open document navigation" onClick={props.onNavigate}><b>{props.page}</b><small>/ {props.count}</small></button>
    <div className="focus-page-step"><button className="icon-button" aria-label={props.pdf ? 'Previous document page' : 'Previous section'} disabled={props.page <= 1} onClick={() => props.onPage(props.page - 1)}><ChevronLeft size={15} /></button><button className="icon-button" aria-label={props.pdf ? 'Next document page' : 'Next section'} disabled={props.page >= props.count} onClick={() => props.onPage(props.page + 1)}><ChevronRight size={15} /></button></div>
    <button className="icon-button" aria-label="Document navigation" aria-expanded={props.navigationOpen} aria-controls="document-navigation" title="Document navigation" onClick={props.onNavigate}><List size={17} /></button>
    <button className="icon-button" aria-label={props.voiceOpen ? 'Hide voice panel' : 'Show voice panel'} aria-expanded={props.voiceOpen} aria-controls="voice-panel" title="Choose a voice" onClick={props.onVoice}><AudioLines size={18} /></button>
    <label className="focus-speed" title="Narration speed"><select aria-label="Narration speed" value={props.speed} onChange={event => props.onSpeed(Number(event.target.value))}>{Array.from({ length: 23 }, (_, index) => Math.round((.65 + index * .05) * 100) / 100).map(value => <option key={value} value={value}>{value.toFixed(2).replace(/0$/, '')}×</option>)}</select></label>
    {props.pdf && <button className="icon-button" aria-label={props.original ? 'Switch to reading view' : 'Switch to original PDF'} title={props.original ? 'Reading view' : 'Original PDF'} onClick={props.onOriginal}>{props.original ? <BookOpen size={17} /> : <FileText size={17} />}</button>}
    <button className={`icon-button ${props.bookmarked ? 'is-bookmarked' : ''}`} aria-label={props.bookmarked ? 'Remove bookmark' : 'Bookmark current passage'} title="Bookmark current passage" onClick={props.onBookmark}><Bookmark size={17} fill={props.bookmarked ? 'currentColor' : 'none'} /></button>
  </aside>;
}
