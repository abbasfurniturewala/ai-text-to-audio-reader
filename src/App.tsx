import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, ArrowDownToLine, ArrowLeft, ArrowRight, BookOpen, Bookmark, Check, CheckCheck, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, CircleHelp, FileText, FolderOpen, Headphones, Library, LoaderCircle, LockKeyhole, Maximize2, Minus, MoreHorizontal, Menu, Palette, PanelRightClose, Pause, Play, Plus, Search, Settings2, ShieldCheck, SkipBack, SkipForward, Timer, Trash2, Upload, Volume2, X } from 'lucide-react';
import { importDocument, makeDocument, welcomeDocument, durationLabel, readPdfNavigation } from './documents';
import { loadLibrary, saveLibrary, addDocument, deleteDocument, openDocumentText, loadPdfBytes } from './library';
import { documentSpeechPlan } from './speechPlan';
import { readerMatches, readingInset, revealReadingTarget } from './readerView';
import { localVoices, availableVoices, blendVoice, findVoice } from './voices';
import { usePlayer } from './usePlayer';
import { useIdlePlayer } from './useIdlePlayer';
import { clearSpeechCache, decodeSpeech, synthesize, pcm16, wavBytesFromInt16Chunks, clockTime } from './audio';
import { speechClipBounds } from './narration';
import PdfPage, { type PdfJump } from './PdfPage';
import ReadingSection from './ReadingSection';
import FocusControls from './FocusControls';
import AudiobookExport from './AudiobookExport';
import ExportJobs from './ExportJobs';
import DocumentNavigation, { LocationControls } from './DocumentNavigation';
import { documentLocations, locationForPosition, chapterLocations, chapterAtPage, flattenLocations } from './locations';
import { NAVIGATION_VERSION, groupOpeningPages, textTopics } from './structure';
import { lastReaderBook, readReaderSession, removeReadingCheckpoint, type ReadingCheckpoint } from './readerSession';
import { useReaderResume } from './useReaderResume';
import type { DocumentLocation } from './locations';
import type { LibraryItem, ReaderDocument, Segment, Voice } from './types';
import cadenceIcon from '../build/icon.svg';

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose(): void; children: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement; dialog.current?.showModal(); return () => previous?.focus(); }, []);
  return <dialog ref={dialog} className="dialog" onCancel={onClose} onClick={e => { if (e.target === dialog.current) onClose(); }}>
    <div className="modal-content"><button className="icon-button modal-close" onClick={onClose} aria-label="Close dialog"><X size={19} /></button><h2>{title}</h2>{subtitle && <p className="modal-subtitle">{subtitle}</p>}{children}</div>
  </dialog>;
}
const Waveform = memo(function Waveform({ active = false, small = false, theme }: { active?: boolean; small?: boolean; theme: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current, context = element?.getContext('2d');
    if (!element || !context) return;
    const heights = [12, 21, 30, 18, 36, 25, 14, 28, 20, 12, 24, 16], started = performance.now();
    let frame = 0, width = 0, height = 0;
    const draw = (now: number) => {
      context.clearRect(0, 0, width, height); context.beginPath();
      const bar = small ? 1.5 : 2, step = (width - bar) / (heights.length - 1);
      heights.forEach((value, index) => {
        const time = (now - started - index * 85) / (small ? 800 : 1000);
        const phase = 1 - Math.abs(1 - Math.max(0, time) % 2), ease = (1 - Math.cos(phase * Math.PI)) / 2;
        const scale = active && time >= 0 ? (small ? .18 + .32 * ease : .4 + .6 * ease) : small ? .4 : .8;
        const size = value * scale;
        context.roundRect(index * step, (height - size) / 2, bar, size, bar / 2);
      });
      context.fill();
      if (active) frame = requestAnimationFrame(draw);
    };
    const resize = () => {
      cancelAnimationFrame(frame);
      const style = getComputedStyle(element), ratio = window.devicePixelRatio || 1;
      width = parseFloat(style.width); height = parseFloat(style.height);
      element.width = Math.round(width * ratio); element.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0); context.fillStyle = style.color;
      draw(performance.now());
    };
    // Paint only the tiny meter; CSS bar animations repeatedly restyled the
    // much larger reader during playback on this Windows renderer.
    resize(); window.addEventListener('resize', resize);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', resize); };
  }, [active, small, theme]);
  return <span aria-hidden="true" className={`waveform ${active ? 'active' : ''} ${small ? 'small' : ''}`}><canvas ref={canvas} /></span>;
});
function VoiceAvatar({ voice, large = false }: { voice: Voice; large?: boolean }) {
  return <span className={`voice-avatar ${voice.color || 'sage'} ${large ? 'large' : ''}`}><AudioLines size={large ? 27 : 21} strokeWidth={1.4} /></span>;
}

export default function App() {
  const [documents, setDocuments] = useState<LibraryItem[]>([]);
  const [openText, setOpenText] = useState<{ id: string; segments: Segment[] }>();
  const [opening, setOpening] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [activeId, setActiveId] = useState('cadence-welcome');
  const [view, setView] = useState<'reader' | 'library' | 'bookmarks' | 'exports'>('reader');
  const [localVoice, setLocalVoice] = useState(() => localStorage.getItem('cadence-local-voice') || 'af_heart');
  const [speed, setSpeed] = useState(() => Number(localStorage.getItem('cadence-speed')) || 1);
  const [startupSeconds, setStartupSeconds] = useState(() => [0, 3, 8].includes(Number(localStorage.getItem('cadence-startup-v2'))) ? Number(localStorage.getItem('cadence-startup-v2')) : 0);
  const [fontSize, setFontSize] = useState(() => Math.max(15, Math.min(28, Number(localStorage.getItem('cadence-font-size')) || 19)));
  const [fontTheme, setFontTheme] = useState<'serif' | 'sans'>(() => localStorage.getItem('cadence-font-theme') === 'sans' ? 'sans' : 'serif');
  const [theme, setTheme] = useState<'slate' | 'midnight' | 'graphite'>(() => { const value = localStorage.getItem('cadence-theme'); return value === 'midnight' || value === 'graphite' ? value : 'slate'; });
  const [voiceFilter, setVoiceFilter] = useState('All voices');
  const [blendPrimary, setBlendPrimary] = useState('af_heart');
  const [blendSecondary, setBlendSecondary] = useState('bf_emma');
  const [blendRatio, setBlendRatio] = useState(65);
  const [modelState, setModelState] = useState('idle');
  const [modelProgress, setModelProgress] = useState<number | undefined>();
  const [modal, setModal] = useState<'paste' | 'settings' | 'export' | 'help' | null>(null);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteText, setNoteText] = useState('');
  const [noteSaving, setNoteSaving] = useState(false), [noteError, setNoteError] = useState('');
  const [textToRead, setTextToRead] = useState<string>();
  const noteInput = useRef<HTMLTextAreaElement>(null), noteRun = useRef(0);
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState('');
  const importAbort = useRef<AbortController | undefined>(undefined);
  const [toast, setToast] = useState<{ message: string; error?: boolean }>();
  const [dragging, setDragging] = useState(false);
  const [search, setSearch] = useState('');
  const [librarySearch, setLibrarySearch] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);
  const [pdfZoom, setPdfZoom] = useState(1);
  const [bookmarkRequest, setBookmarkRequest] = useState<{ id: string; index: number; page?: number }>();
  const [removed, setRemoved] = useState<LibraryItem>();
  const removal = useRef<{ item: LibraryItem; index: number; active: boolean; timer: ReturnType<typeof setTimeout> } | undefined>(undefined);
  const removalBusy = useRef(false);
  const removalWork = useRef<Promise<void> | undefined>(undefined);
  const [showSearch, setShowSearch] = useState(false);
  const [original, setOriginal] = useState(false);
  const [speechCue, setSpeechCue] = useState<'highlight' | 'underline'>(() => localStorage.getItem('cadence-speech-cue') === 'underline' ? 'underline' : 'highlight');
  const [pdfPage, setPdfPage] = useState(1);
  const [followAudio, setFollowAudio] = useState(false);
  const [revealRequest, setRevealRequest] = useState(0);
  const [navigationOpen, setNavigationOpen] = useState(() => localStorage.getItem('cadence-navigation-open') === null ? window.innerWidth >= 1280 : localStorage.getItem('cadence-navigation-open') === 'true');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const libraryMenu = useRef<HTMLDialogElement>(null);
  const bookmarksFrom = useRef<{ view: 'reader' | 'library'; id: string; index: number; page?: number }>({ view: 'reader', id: '', index: 0 });
  const [voiceOpen, setVoiceOpen] = useState(() => localStorage.getItem('cadence-voice-open') !== 'false');
  const [focusMode, setFocusMode] = useState(false);
  const [focusVoiceOpen, setFocusVoiceOpen] = useState(false);
  const [focusNavigationOpen, setFocusNavigationOpen] = useState(false);
  const [playerFocused, setPlayerFocused] = useState(false);
  const [findingTopics, setFindingTopics] = useState(false);
  const [visibleLocation, setVisibleLocation] = useState('');
  const [visiblePassage, setVisiblePassage] = useState(0);
  const [browseRequest, setBrowseRequest] = useState<PdfJump>();
  const [navigationRefresh, setNavigationRefresh] = useState<string>();
  const [previewing, setPreviewing] = useState(false);
  const [sleep, setSleep] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportRange, setExportRange] = useState<'all' | 'remaining'>('all');
  const [exportResult, setExportResult] = useState<{ url: string; filename: string }>();
  const exportCancelled = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const previewAudio = useRef<HTMLAudioElement | null>(null);
  const previewRun = useRef(0);
  const previewAbort = useRef<AbortController | undefined>(undefined);
  const previewUrl = useRef<string | undefined>(undefined);
  const activeParagraph = useRef<HTMLButtonElement>(null);
  const readerScroll = useRef<HTMLDivElement>(null);
  const panelAnchor = useRef<{ element: HTMLElement; offset: number; fraction?: number } | undefined>(undefined);
  const activeItem = documents.find(d => d.id === activeId);
  const doc = useMemo<ReaderDocument | undefined>(() => activeItem && openText?.id === activeId ? { ...activeItem, segments: openText.segments } : undefined, [activeItem, openText, activeId]);
  const nativePdf = original && doc?.kind === 'PDF';
  const locations = useMemo(() => documentLocations(doc), [doc?.id, doc?.segments, doc?.pageCount, doc?.pageLabels]);
  const effectiveTopics = useMemo(() => doc && doc.navigationVersion === NAVIGATION_VERSION ? doc.topics || [] : doc ? (doc.kind === 'PDF' ? groupOpeningPages(textTopics(doc.segments, true)) : textTopics(doc.segments)) : [], [doc?.id, doc?.topics, doc?.navigationVersion, doc?.segments]);
  const chapters = useMemo(() => chapterLocations(doc ? { ...doc, topics: effectiveTopics } : undefined, locations), [doc?.id, effectiveTopics, locations]);
  const chapterTargets = useMemo(() => new Map(flattenLocations(chapters).map(entry => [entry.key, entry])), [chapters]);
  const currentLocation = locations.find(location => location.key === (nativePdf ? `page-${pdfPage}` : visibleLocation)) || locations[0];
  const audioLocation = locationForPosition(locations, doc?.position || 0);
  const matches = useMemo(() => readerMatches(doc?.segments || [], search), [doc?.segments, search]);
  const currentMatch = matches[Math.min(searchIndex, matches.length - 1)];
  const sidebarCurrent = chapterAtPage(chapters, currentLocation?.page || 1, nativePdf ? undefined : visiblePassage);
  const sidebarAudio = chapterAtPage(chapters, audioLocation?.page || 1, doc?.position);
  const voices = voiceFilter === 'Curated voices' ? localVoices : availableVoices;
  const voice = findVoice(localVoice) || localVoices[0];
  const voiceId = voice.id;
  const notify = useCallback((message: string, error = false) => setToast({ message: message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), error }), []);
  const updatePosition = useCallback((position: number) => setDocuments(items => items.map(item => item.id === activeId ? { ...item, position, updated: Date.now() } : item)), [activeId]);
  const player = usePlayer(doc, voiceId, speed, updatePosition, useCallback(message => notify(message, true), [notify]), startupSeconds, !exporting && !previewing);
  const playing = player.state === 'playing';
  const busy = player.state === 'loading';
  const wordOffsets = useMemo(() => {
    const offsets = [0];
    for (const segment of doc?.segments || []) offsets.push(offsets.at(-1)! + (segment.text.match(/\S+/g)?.length || 0));
    return offsets;
  }, [doc?.segments]);
  const totalWords = wordOffsets.at(-1) || 0;
  const beforeWords = wordOffsets[doc?.position || 0] || 0;
  const segmentWords = (wordOffsets[(doc?.position || 0) + 1] || beforeWords) - beforeWords;
  const progress = totalWords ? ((beforeWords + segmentWords * player.fraction) / totalWords) * 100 : 0;
  const estimatedSeconds = totalWords / 165 * 60;
  const elapsed = estimatedSeconds * progress / 100;
  const bookmarks = doc?.bookmarks || [];
  const bookmarkPosition = nativePdf ? bookmarks.find(index => doc?.segments[index]?.page === pdfPage) ?? doc?.segments.findIndex(segment => segment.page === pdfPage) ?? -1 : visiblePassage;
  const viewedBookmark = bookmarkPosition >= 0 && bookmarks.includes(bookmarkPosition);
  const voiceVisible = view !== 'exports' && (focusMode ? focusVoiceOpen : voiceOpen);
  const navigationVisible = focusMode ? focusNavigationOpen : navigationOpen;
  const restoreReading = useCallback((location: DocumentLocation, point: ReadingCheckpoint) => {
    panelAnchor.current = undefined;
    setFollowAudio(false); setOriginal(point.original); setPdfPage(point.page);
    setVisibleLocation(location.key); setVisiblePassage(point.segment ?? location.start);
    setBrowseRequest({ key: location.key, ...(point.segment !== undefined ? { segment: point.segment } : {}) });
  }, []);
  const { flush: flushReading, interrupt: interruptReadingResume } = useReaderResume({ doc, locations, scroll: readerScroll, reading: view === 'reader', original, pdfPage, visibleLocation, visiblePassage, search, restore: restoreReading, onError: () => notify('Your reading position could not be saved. Check available disk space.', true) });
  const finishRemoval = useCallback(async () => {
    const pending = removal.current;
    if (!pending) { await removalWork.current; return; }
    clearTimeout(pending.timer); removal.current = undefined; setRemoved(undefined);
    const task = deleteDocument(pending.item.id); removalWork.current = task;
    try {
      await task;
      try { removeReadingCheckpoint(localStorage, pending.item.id); } catch { /* The book was removed successfully. */ }
    } catch (error) {
      setDocuments(items => items.some(item => item.id === pending.item.id) ? items : [...items, pending.item]);
      notify('The book could not be removed. It has been returned to your library.', true);
      throw error;
    }
    finally { if (removalWork.current === task) removalWork.current = undefined; }
  }, [notify]);
  const closingSnapshot = useRef({ loaded, documents }); closingSnapshot.current = { loaded, documents };
  const librarySaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closingApp = useRef(false);
  useEffect(() => window.cadence?.onBeforeClose(async () => {
    closingApp.current = true;
    clearTimeout(librarySaveTimer.current);
    flushReading();
    await finishRemoval().catch(() => {});
    const snapshot = closingSnapshot.current;
    if (snapshot.loaded) await saveLibrary(snapshot.documents);
  }), [flushReading, finishRemoval]);

  useEffect(() => {
    loadLibrary().then(async items => {
      const initial = items ?? [await addDocument(welcomeDocument())];
      setDocuments(initial);
      setActiveId(lastReaderBook(localStorage, initial.map(item => item.id)));
    }).catch(() => { notify('Your saved library could not be opened. Please restart the app to try again.', true); }).finally(() => setLoaded(true));
    if (window.cadence) {
      void window.cadence.fullScreen().then(setFocusMode).catch(() => {});
      void window.cadence.status().then(status => setModelState(status.modelReady ? 'ready' : 'idle'));
      return window.cadence.onModelProgress(p => {
        if (p.status === 'progress') { setModelState('loading'); setModelProgress(p.progress); }
        if (p.status === 'ready') { setModelState('ready'); setModelProgress(undefined); }
      });
    }
  }, [notify]);
  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    setOpenText(undefined); setOpening(!!activeId);
    clearSpeechCache();
    if (activeId) void openDocumentText(activeId).then(({ segments, item }) => {
      if (!cancelled) {
        setDocuments(items => items.map(existing => existing.id === activeId && (existing.textVersion || 0) < (item.textVersion || 0) ? item : existing));
        setOpenText({ id: activeId, segments });
      }
    }).catch(error => { if (!cancelled) notify(error.message, true); }).finally(() => { if (!cancelled) setOpening(false); });
    return () => { cancelled = true; };
  }, [activeId, loaded, notify]);
  useEffect(() => { if (!loaded || closingApp.current) return; const timer = setTimeout(() => { void saveLibrary(documents).catch(() => notify('Your library could not be saved. Free some disk space and try again.', true)); }, 400); librarySaveTimer.current = timer; return () => clearTimeout(timer); }, [documents, loaded, notify]);
  useEffect(() => { if (loaded && (!activeId || activeItem)) localStorage.setItem('cadence-document', activeId); setOriginal(false); setSearch(''); setShowSearch(false); setPdfPage(1); setPdfZoom(1); setFollowAudio(false); }, [activeId, loaded]);
  useEffect(() => { localStorage.setItem('cadence-local-voice', localVoice); localStorage.setItem('cadence-speed', String(speed)); }, [localVoice, speed]);
  useEffect(() => { localStorage.setItem('cadence-startup-v2', String(startupSeconds)); }, [startupSeconds]);
  useLayoutEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('cadence-theme', theme); }, [theme]);
  useEffect(() => {
    const menu = libraryMenu.current;
    if (!menu) return;
    if (libraryOpen && !focusMode) { if (!menu.open) menu.showModal(); } else if (menu.open) menu.close();
  }, [libraryOpen, focusMode]);
  useEffect(() => { localStorage.setItem('cadence-navigation-open', String(navigationOpen)); }, [navigationOpen]);
  useEffect(() => { localStorage.setItem('cadence-voice-open', String(voiceOpen)); }, [voiceOpen]);
  useEffect(() => { localStorage.setItem('cadence-speech-cue', speechCue); }, [speechCue]);
  useEffect(() => { localStorage.setItem('cadence-font-size', String(fontSize)); localStorage.setItem('cadence-font-theme', fontTheme); }, [fontSize, fontTheme]);
  useEffect(() => { setSearchIndex(0); }, [search]);
  useEffect(() => {
    if (!nativePdf || !currentMatch || !search) return;
    interruptReadingResume(); setFollowAudio(false); setPdfPage(currentMatch.page);
    setBrowseRequest({ key: `page-${currentMatch.page}`, segment: currentMatch.segment, character: currentMatch.start, center: true });
  }, [nativePdf, search, searchIndex, doc?.id]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(undefined), toast.error ? 10000 : 4500); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { setVisibleLocation(''); setBrowseRequest(undefined); }, [activeId]);
  useEffect(() => {
    if (!doc) return;
    if (doc.kind !== 'PDF') {
      if (doc.navigationVersion !== NAVIGATION_VERSION || navigationRefresh === doc.id) {
        const topics = textTopics(doc.segments);
        setDocuments(items => items.map(item => item.id === doc.id ? { ...item, topics, navigationVersion: NAVIGATION_VERSION, navigationSource: topics.length ? 'headings' : 'none' } : item));
        setNavigationRefresh(undefined);
      }
      setFindingTopics(false); return;
    }
    if (doc.navigationVersion === NAVIGATION_VERSION && Array.isArray(doc.pageLabels) && navigationRefresh !== doc.id) { setFindingTopics(false); return; }
    const abort = new AbortController();
    const id = doc.id;
    setFindingTopics(true);
    void loadPdfBytes(id).then(bytes => readPdfNavigation(bytes, abort.signal, doc.segments)).then(metadata => { if (!abort.signal.aborted) { setDocuments(items => items.map(item => item.id === id ? { ...item, ...metadata } : item)); setFindingTopics(false); setNavigationRefresh(undefined); } }).catch(() => { if (!abort.signal.aborted) { setFindingTopics(false); setNavigationRefresh(undefined); } });
    return () => { abort.abort(); };
  }, [doc?.id, doc?.navigationVersion, doc?.pageLabels, navigationRefresh]);
  // Track the page/section at the top of the reading viewport, independently
  // of the spoken passage. Scrolling never changes playback position.
  useEffect(() => {
    const scroller = readerScroll.current;
    if (!scroller || nativePdf || view !== 'reader') return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const probe = scroller.getBoundingClientRect().top + Math.min(80, scroller.clientHeight / 5);
      const sections = Array.from(scroller.querySelectorAll<HTMLElement>('[data-location-key]'));
      let selected = sections[0];
      for (const section of sections) { if (section.getBoundingClientRect().top <= probe) selected = section; else break; }
      if (sections.length && scroller.scrollTop > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) selected = sections[sections.length - 1];
      if (browseRequest && scroller.scrollHeight <= scroller.clientHeight + 2) selected = sections.find(section => section.dataset.locationKey === browseRequest.key) || selected;
      if (selected) {
        setVisibleLocation(selected.dataset.locationKey!);
        const passages = Array.from(selected.querySelectorAll<HTMLElement>('[data-passage-index]'));
        const passageProbe = scroller.getBoundingClientRect().top + readingInset(selected);
        const visible = passages.find(passage => passage.getBoundingClientRect().bottom > passageProbe) || passages.at(-1);
        if (visible) setVisiblePassage(Number(visible.dataset.passageIndex));
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    scroller.addEventListener('scroll', schedule, { passive: true });
    const observer = new ResizeObserver(schedule); observer.observe(scroller);
    update();
    return () => { scroller.removeEventListener('scroll', schedule); observer.disconnect(); cancelAnimationFrame(frame); };
  }, [doc?.id, locations, original, search, view, browseRequest]);
  const capturePanelAnchor = useCallback(() => {
    const scroller = readerScroll.current;
    if (!scroller) return;
    const viewport = scroller.getBoundingClientRect();
    if (nativePdf) {
      const canvas = scroller.querySelector<HTMLElement>(`[data-pdf-page="${currentLocation?.page || 1}"]`);
      const bounds = canvas?.getBoundingClientRect();
      if (canvas && bounds?.height) {
        const intoPage = Math.max(0, Math.min(bounds.height, viewport.top + 30 - bounds.top));
        panelAnchor.current = { element: canvas, offset: bounds.top + intoPage - viewport.top, fraction: intoPage / bounds.height };
      }
      return;
    }
    const section = scroller.querySelector<HTMLElement>(`[data-location-key="${currentLocation?.key || ''}"]`) || scroller;
    const element = Array.from(section.querySelectorAll<HTMLElement>('.passage')).find(passage => passage.getBoundingClientRect().bottom > viewport.top + 30);
    if (element) panelAnchor.current = { element, offset: element.getBoundingClientRect().top - viewport.top };
  }, [nativePdf, currentLocation?.key]);
  const playerActive = useIdlePlayer(`${focusMode}:${activeId}`, capturePanelAnchor);
  const playerExpanded = !playerActive.manualHidden && (playerActive.visible || playerFocused);
  useLayoutEffect(() => {
    const anchor = panelAnchor.current, scroller = readerScroll.current;
    panelAnchor.current = undefined;
    if (anchor?.element.isConnected && scroller) {
      const bounds = anchor.element.getBoundingClientRect();
      const top = scroller.scrollTop + bounds.top + bounds.height * (anchor.fraction || 0) - scroller.getBoundingClientRect().top - anchor.offset;
      if (Math.abs(top - scroller.scrollTop) > .5) scroller.scrollTo({ top, behavior: 'instant' });
    }
  });
  const closeNavigation = useCallback(() => { capturePanelAnchor(); if (focusMode) setFocusNavigationOpen(false); else setNavigationOpen(false); }, [capturePanelAnchor, focusMode]);
  const toggleNavigation = useCallback(() => {
    capturePanelAnchor();
    if (focusMode) { setFocusNavigationOpen(value => !value); setFocusVoiceOpen(false); }
    else setNavigationOpen(value => !value);
  }, [capturePanelAnchor, focusMode]);
  const toggleLibrary = useCallback(() => setLibraryOpen(value => !value), []);
  const toggleVoicePanel = useCallback(() => {
    capturePanelAnchor();
    if (focusMode) { setFocusVoiceOpen(value => !value); setFocusNavigationOpen(false); }
    else setVoiceOpen(value => !value);
  }, [capturePanelAnchor, focusMode]);
  const toggleFullScreen = useCallback(async () => {
    setLibraryOpen(false); capturePanelAnchor();
    try {
      if (window.cadence) await window.cadence.setFullScreen(!focusMode);
      else if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { panelAnchor.current = undefined; notify('Full screen could not be opened. Please try again.', true); }
  }, [capturePanelAnchor, notify, focusMode]);
  useEffect(() => {
    const changed = (enabled: boolean) => {
      if (enabled === focusMode) return;
      if (!panelAnchor.current) capturePanelAnchor();
      setFocusMode(enabled); if (enabled) setLibraryOpen(false);
      setFocusVoiceOpen(false); setFocusNavigationOpen(false);
      setPlayerFocused(false);
    };
    const htmlChanged = () => changed(document.fullscreenElement === document.documentElement);
    if (window.cadence) return window.cadence.onFullScreen(changed);
    document.addEventListener('fullscreenchange', htmlChanged);
    return () => document.removeEventListener('fullscreenchange', htmlChanged);
  }, [capturePanelAnchor, focusMode]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.key !== 'F11' && !(event.key === 'Escape' && focusMode)) || event.repeat || modal || !doc || view !== 'reader') return;
      event.preventDefault(); void toggleFullScreen();
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [doc?.id, view, modal, toggleFullScreen, focusMode]);
  useEffect(() => {
    if (focusMode && (view !== 'reader' || (!doc && !opening))) {
      if (window.cadence) void window.cadence.setFullScreen(false);
      else void document.exitFullscreen().catch(() => {});
    }
  }, [focusMode, view, doc?.id, opening]);
  const navigateToLocation = useCallback((key: string) => {
    const topic = chapterTargets.get(key);
    const location = topic ? locations.find(item => doc?.kind === 'PDF' ? item.page === topic.page : topic.start >= item.start && topic.start < item.end) : locations.find(item => item.key === key);
    if (!location) return;
    interruptReadingResume();
    panelAnchor.current = undefined;
    setFollowAudio(false); setSearch(''); setVisibleLocation(location.key); setPdfPage(location.page);
    setVisiblePassage(topic?.start ?? location.start);
    setBrowseRequest({ key: location.key, ...(topic?.targetSegment !== undefined ? { segment: topic.targetSegment } : {}), ...(topic?.y !== undefined ? { y: topic.y } : {}) });
    if (focusMode) setFocusNavigationOpen(false);
    else if (window.innerWidth < 1280) setNavigationOpen(false);
  }, [locations, chapterTargets, doc?.kind, focusMode, interruptReadingResume]);
  useLayoutEffect(() => {
    if (!bookmarkRequest || doc?.id !== bookmarkRequest.id || view !== 'reader') return;
    const location = bookmarkRequest.page !== undefined ? locations.find(item => item.page === bookmarkRequest.page) : locationForPosition(locations, bookmarkRequest.index);
    if (!location) return;
    interruptReadingResume(); setSearch(''); setFollowAudio(false); setPdfPage(location.page);
    panelAnchor.current = undefined;
    setVisibleLocation(location.key); setVisiblePassage(bookmarkRequest.index);
    setBrowseRequest({ key: location.key, ...(bookmarkRequest.index >= location.start && bookmarkRequest.index < location.end ? { segment: bookmarkRequest.index } : {}) }); setBookmarkRequest(undefined);
  }, [bookmarkRequest, doc?.id, locations, view, interruptReadingResume]);
  useEffect(() => {
    if (!browseRequest || view !== 'reader') return;
    const scroller = readerScroll.current;
    if (!scroller) return;
    if (nativePdf) return;
    let frame = 0;
    const started = performance.now();
    const cancel = () => { cancelAnimationFrame(frame); };
    const position = () => {
      const section = Array.from(scroller.querySelectorAll<HTMLElement>('[data-location-key]')).find(item => item.dataset.locationKey === browseRequest.key);
      const target = browseRequest.segment !== undefined ? section?.querySelector<HTMLElement>(`[data-passage-index="${browseRequest.segment}"]`) || section : section;
      if (target) revealReadingTarget(scroller, target, browseRequest.center);
      if (performance.now() - started < 180) frame = requestAnimationFrame(position); else flushReading();
    };
    position();
    const events = ['wheel', 'pointerdown', 'keydown', 'touchstart'] as const;
    events.forEach(name => window.addEventListener(name, cancel, { passive: true }));
    return () => { cancel(); events.forEach(name => window.removeEventListener(name, cancel)); };
  }, [browseRequest, original, view, flushReading]);
  function switchReaderView(showOriginal: boolean) {
    interruptReadingResume();
    panelAnchor.current = undefined;
    if (doc?.kind !== 'PDF') {
      setSearch(''); setBrowseRequest({ key: currentLocation?.key || 'section-1', segment: visiblePassage });
    } else if (showOriginal) {
      const page = currentLocation?.page || 1;
      setPdfPage(page);
      setBrowseRequest({ key: `page-${page}`, segment: visiblePassage });
    }
    else { setSearch(''); setBrowseRequest({ key: `page-${pdfPage}` }); }
    setOriginal(showOriginal);
  }
  function revealAudio() {
    interruptReadingResume();
    panelAnchor.current = undefined;
    const scroller = readerScroll.current;
    if (!scroller || !doc) return;
    if (nativePdf) {
      const part = player.spokenParts?.find(part => part.segment === doc.position) || player.spokenParts?.[0], segment = part?.segment ?? doc.position;
      const page = doc.segments[segment]?.page || 1;
      setPdfPage(page); setBrowseRequest({ key: `page-${page}`, segment, character: part?.start, center: true });
    } else if (audioLocation) {
      setBrowseRequest({ key: audioLocation.key, segment: doc.position, center: true });
    }
  }
  function goToAudio() { setSearch(''); setRevealRequest(value => value + 1); }
  function toggleFollowAudio() { if (!followAudio) goToAudio(); setFollowAudio(value => !value); }
  // Browsing and listening positions are independent. Only an explicit follow
  // choice or Go to audio may move the viewport when narration advances.
  useEffect(() => { if (followAudio && (playing || busy) && view === 'reader') revealAudio(); }, [doc?.position, player.spokenParts, playing, busy, followAudio, original, view]);
  useEffect(() => { if (revealRequest) revealAudio(); }, [revealRequest]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) || target.isContentEditable || modal || libraryOpen) return;
      if (event.code === 'Space') { event.preventDefault(); togglePlayback(); }
      if (event.key === 'ArrowRight') { event.preventDefault(); player.seekSeconds(15); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); player.seekSeconds(-15); }
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, [player, modal, libraryOpen]);
  useEffect(() => { if (!sleep) return; const timer = setTimeout(() => { player.stop(); setSleep(0); notify('Sleep timer finished. Your place is saved.'); }, sleep * 60000); return () => clearTimeout(timer); }, [sleep, player.stop, notify]);
  const stopPreview = useCallback(() => {
    previewAbort.current?.abort(); previewAbort.current = undefined;
    previewRun.current++; previewAudio.current?.pause();
    if (previewAudio.current) { previewAudio.current.removeAttribute('src'); previewAudio.current.load(); previewAudio.current = null; }
    if (previewUrl.current) { URL.revokeObjectURL(previewUrl.current); previewUrl.current = undefined; }
    setPreviewing(false);
  }, []);
  function togglePlayback() { stopPreview(); player.toggle(); }
  useEffect(() => () => { previewAbort.current?.abort(); }, []);
  useEffect(() => { stopPreview(); setExportResult(undefined); }, [voiceId, activeId, stopPreview]);
  useEffect(() => () => { if (exportResult) URL.revokeObjectURL(exportResult.url); }, [exportResult]);

  const selectDocument = (item: LibraryItem) => { if (exporting) return; setTextToRead(undefined); flushReading(); player.stop(); stopPreview(); setSearch(''); setShowSearch(false); setActiveId(item.id); setView('reader'); setLibraryOpen(false); };
  useEffect(() => {
    if (!textToRead || closingApp.current) return;
    if (activeId !== textToRead) { setTextToRead(undefined); return; }
    if (doc?.id === textToRead) { setTextToRead(undefined); stopPreview(); player.playFrom(0); }
  }, [textToRead, activeId, doc?.id, stopPreview, player.playFrom]);
  useEffect(() => { if (modal === 'paste') noteInput.current?.focus(); }, [modal]);
  function openTextReader() { noteRun.current++; setNoteSaving(false); setNoteError(''); setLibraryOpen(false); setModal('paste'); }
  function closeTextReader() { noteRun.current++; setNoteSaving(false); setModal(null); }
  function openBookmarks() {
    if (view !== 'bookmarks') {
      flushReading();
      const point = doc && !search ? readReaderSession(localStorage).books[doc.id] : undefined;
      bookmarksFrom.current = { view: view === 'reader' ? 'reader' : 'library', id: doc?.id || '', index: nativePdf ? Math.max(0, doc?.segments.findIndex(segment => segment.page === (point?.page ?? pdfPage)) ?? 0) : point?.segment ?? visiblePassage, ...(doc?.kind === 'PDF' ? { page: point?.page ?? currentLocation?.page ?? pdfPage } : {}) };
    }
    setView('bookmarks'); setLibraryOpen(false); setSearch(''); setShowSearch(false);
  }
  function backFromBookmarks() {
    const previous = bookmarksFrom.current;
    setLibraryOpen(false);
    if (previous.view === 'reader' && doc && previous.id === doc.id) { setView('reader'); setBookmarkRequest({ id: doc.id, index: previous.index, page: previous.page }); }
    else setView('library');
  }
  function openExportManager() {
    flushReading(); setModal(null); setLibraryOpen(false); setView('exports'); setSearch(''); setShowSearch(false);
  }
  async function importFiles(files: FileList | File[]) {
    if (importAbort.current || exporting) return;
    const abort = new AbortController(); importAbort.current = abort;
    setImporting(true);
    let last: LibraryItem | undefined;
    const pending = Array.from(files);
    for (const file of pending) {
      if (abort.signal.aborted) break;
      setImportStatus(`Opening ${file.name}…`);
      try {
        const parsed = await importDocument(file, { signal: abort.signal, onProgress: (page, total) => setImportStatus(`${file.name} · page ${page} of ${total}`) });
        abort.signal.throwIfAborted();
        const item = await addDocument(parsed);
        setDocuments(items => [item, ...items]); last = item;
      } catch (error) { if (!abort.signal.aborted) notify(error instanceof Error ? error.message : 'Could not import this document.', true); }
    }
    if (last) selectDocument(last);
    if (abort.signal.aborted) notify('Import cancelled. Documents already added remain on your shelf.');
    else if (last) notify(pending.length > 1 ? 'Your documents are in the library.' : 'Your document is ready to listen.');
    setImporting(false);
    setImportStatus(''); importAbort.current = undefined;
    if (input.current) input.current.value = '';
  }
  async function addNote(readAloud = false) {
    if (noteSaving || exporting || !noteText.trim()) return;
    const run = ++noteRun.current; setNoteSaving(true); setNoteError('');
    try {
      const item = await addDocument(makeDocument(noteTitle.trim() || 'Pasted text', noteText)); setDocuments(items => [item, ...items]);
      if (closingApp.current || run !== noteRun.current) return;
      selectDocument(item); if (readAloud) setTextToRead(item.id);
      setNoteTitle(''); setNoteText(''); setModal(null);
    } catch (error) { if (run === noteRun.current) setNoteError(error instanceof Error ? error.message : 'Your text could not be saved. Please try again.'); }
    finally { if (run === noteRun.current) setNoteSaving(false); }
  }
  function toggleBookmark(position = bookmarkPosition) {
    if (!doc?.segments[position]) return;
    setDocuments(items => items.map(item => {
      if (item.id !== activeId) return item;
      const bookmarks = item.bookmarks.includes(position) ? item.bookmarks.filter(i => i !== position) : [...item.bookmarks, position].sort((a, b) => a - b);
      return { ...item, bookmarks, bookmarkPreviews: Object.fromEntries(bookmarks.map(index => [index, doc.segments[index]])) };
    }));
  }
  async function removeDocument(item: LibraryItem) {
    if (exporting || removalBusy.current) return;
    removalBusy.current = true;
    try {
      await finishRemoval(); flushReading(); await saveLibrary([item]);
      const timer = setTimeout(() => { void finishRemoval().catch(() => {}); }, 10000);
      removal.current = { item, index: documents.findIndex(book => book.id === item.id), active: item.id === activeId, timer };
      setRemoved(item);
      setDocuments(items => items.filter(d => d.id !== item.id));
      if (item.id === activeId) { player.stop(); stopPreview(); clearSpeechCache(); setOpenText(undefined); setExportResult(undefined); setActiveId(''); setView('library'); }
    } catch (error) { notify((error as Error).message, true); }
    finally { removalBusy.current = false; }
  }
  function undoRemoval() {
    const pending = removal.current;
    if (!pending) return;
    clearTimeout(pending.timer); removal.current = undefined; setRemoved(undefined);
    setDocuments(items => { const restored = [...items]; restored.splice(Math.max(0, Math.min(items.length, pending.index)), 0, pending.item); return restored; });
    if (pending.active) { setActiveId(pending.item.id); setView('reader'); }
    notify('Book restored, including your bookmarks and reading place.');
  }
  async function previewVoice() {
    if (previewing) { stopPreview(); return; }
    player.stop(); stopPreview(); const token = ++previewRun.current, abort = new AbortController(); previewAbort.current = abort; setPreviewing(true);
    try {
      const audio = await synthesize({ text: `Hello, I'm ${voice.name}. Settle in, take a breath, and let the words come to you. I'll take it from here.`, voice: voiceId, engine: 'local' }, { signal: abort.signal });
      if (token !== previewRun.current) return;
      const url = URL.createObjectURL(new Blob([new Uint8Array(audio.bytes)], { type: audio.mime }));
      previewUrl.current = url;
      const element = new Audio(url); previewAudio.current = element; element.playbackRate = speed;
      element.onended = () => { if (token === previewRun.current) stopPreview(); };
      await element.play();
    } catch (error) { if (token === previewRun.current) { stopPreview(); notify((error as Error).message, true); } }
  }
  async function prepareModel() {
    if (!window.cadence) { notify('Launch the Windows app using Start Cadence to set up local voices.', true); return; }
    setModelState('loading'); setModelProgress(undefined);
    try { await window.cadence.loadModel(); setModelState('ready'); notify('Local voices are ready. Happy listening.'); }
    catch (error) { setModelState('idle'); notify((error as Error).message, true); }
  }
  async function exportAudio() {
    if (!doc || exporting) return;
    if (!window.cadence) { notify('Audio export is available in the Windows app.', true); return; }
    player.stop(); stopPreview(); setExporting(true); setExportProgress(0); setExportResult(undefined); exportCancelled.current = false;
    const segments = documentSpeechPlan(doc, exportRange === 'remaining' ? doc.position : 0);
    const context = new AudioContext({ sampleRate: 24000 });
    const chunks: Int16Array[] = [];
    let length = 0;
    try {
      for (let index = 0; index < segments.length; index++) {
        if (exportCancelled.current) return;
        const audio = await synthesize({ text: segments[index].text, engine: 'local', voice: voiceId });
        if (exportCancelled.current) return;
        const samples = await decodeSpeech(audio, context);
        const bounds = speechClipBounds(samples, context.sampleRate, segments[index], segments[index + 1]);
        const start = Math.round(bounds.offset * context.sampleRate), end = Math.min(samples.length, Math.round((bounds.offset + bounds.duration) * context.sampleRate));
        const chunk = pcm16(samples, start, end);
        chunks.push(chunk); length += chunk.length;
        if (length > 24000 * 60 * 60 * 2) throw new Error('For long books, export a smaller section at a time. The WAV limit is two hours per export.');
        setExportProgress(Math.round((index + 1) / segments.length * 100));
      }
      if (exportCancelled.current) return;
      const bytes = wavBytesFromInt16Chunks(chunks, context.sampleRate);
      const filename = `${doc.title} — ${voice.name}`;
      const url = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/wav' }));
      setExportResult({ url, filename });
      notify('Audio generated. Choose Save WAV to save it to your computer.');
    } catch (error) { notify((error as Error).message, true); }
    finally { await context.close(); setExporting(false); }
  }

  const filteredVoices = voices.filter(v => voiceFilter === 'All voices' || voiceFilter === 'Curated voices' || v.accent === voiceFilter || v.gender.toLowerCase() === voiceFilter.toLowerCase());
  const libraryItems = documents.filter(item => !librarySearch || item.title.toLowerCase().includes(librarySearch.toLowerCase()));
  const readFrom = useCallback((index: number, character: number) => { stopPreview(); player.playFrom(index, character); }, [stopPreview, player.playFrom]);
  const readPdfWord = useCallback((index: number, character: number) => { if (!exporting && voiceId) readFrom(index, character); }, [exporting, voiceId, readFrom]);
  const showOriginalPage = useCallback((page: number) => { setFollowAudio(false); setPdfPage(page); setBrowseRequest({ key: `page-${page}` }); setOriginal(true); }, []);
  const rebuildNavigation = useCallback(() => setNavigationRefresh(activeId), [activeId]);
  const readingSections = useMemo(() => !doc || nativePdf || view !== 'reader' ? null : locations.map(location => <ReadingSection key={`${doc.id}-${location.key}`} location={location} segments={doc.segments} pdf={doc.kind === 'PDF'} count={locations.length} spokenParts={player.spokenParts?.some(part => part.segment >= location.start && part.segment < location.end) ? player.spokenParts : undefined} position={doc.position >= location.start && doc.position < location.end ? doc.position : -1} bookmarks={bookmarks} search={search} disabled={exporting || !voiceId} force={location.key === browseRequest?.key || location.key === audioLocation?.key} target={location.key === browseRequest?.key ? browseRequest.segment ?? location.start : undefined} fontSize={fontSize} fontTheme={fontTheme} activeRef={activeParagraph} onRead={readFrom} onOriginal={showOriginalPage} />), [doc?.id, doc?.kind, doc?.segments, doc?.position, nativePdf, view, locations, player.spokenParts, bookmarks, search, exporting, voiceId, browseRequest?.key, browseRequest?.segment, audioLocation?.key, fontSize, fontTheme, readFrom, showOriginalPage]);

  return <div data-speech-cue={speechCue} className={`app-shell library-hidden ${voiceVisible ? '' : 'voice-hidden'} ${focusMode ? 'focus-mode' : ''} ${view === 'reader' && doc ? 'is-reading' : ''} ${dragging ? 'dragging' : ''}`} onDragOver={e => { e.preventDefault(); if (e.dataTransfer.types.includes('Files')) setDragging(true); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }} onDrop={e => { e.preventDefault(); setDragging(false); void importFiles(e.dataTransfer.files); }}>
    <input className="sr-only" ref={input} type="file" accept=".pdf,.docx,.epub,.txt,.md" multiple aria-label="Import documents" onChange={e => { if (e.target.files) void importFiles(e.target.files); }} />
    <dialog ref={libraryMenu} className="library-menu" aria-label="Main menu" onCancel={() => setLibraryOpen(false)} onClose={() => setLibraryOpen(false)} onClick={event => { if (event.target === event.currentTarget) setLibraryOpen(false); }}>
    <aside className="sidebar" id="library-sidebar">
      <div className="menu-heading"><span>Menu</span><button className="icon-button" aria-label="Close menu" onClick={() => setLibraryOpen(false)}><X size={18} /></button></div>
      <button className="brand" onClick={() => { setView('reader'); setLibraryOpen(false); if (!doc && documents[0]) setActiveId(documents[0].id); }}><span className="brand-symbol"><img src={cadenceIcon} alt="" aria-hidden="true" width="38" height="38" /></span><span>cadence<span className="brand-dot">.</span></span></button>
      <div className="sidebar-caption">A LITTLE MORE LIFE IN EVERY WORD</div>
      <button className="primary import-button" onClick={() => { setLibraryOpen(false); input.current?.click(); }} disabled={importing || exporting}>{importing ? <LoaderCircle className="spin" size={17} /> : <Plus size={18} />} {importing ? 'Opening document…' : 'Import document'}</button>
      <nav aria-label="Main navigation">
        <button className="nav-item" onClick={openTextReader}><FileText size={18} /> Text reader</button>
        <button className={view === 'library' || view === 'reader' ? 'nav-item selected' : 'nav-item'} onClick={() => { flushReading(); setView('library'); setLibraryOpen(false); setLibrarySearch(''); setSearch(''); }}><Library size={19} /> My library <span>{documents.length}</span></button>
        <button className={view === 'bookmarks' ? 'nav-item selected' : 'nav-item'} onClick={openBookmarks}><Bookmark size={18} /> Bookmarks <span>{documents.reduce((n, d) => n + d.bookmarks.length, 0)}</span></button>
        <button className={view === 'exports' ? 'nav-item selected' : 'nav-item'} onClick={openExportManager}><ArrowDownToLine size={18} /> Audio exports</button>
      </nav>
      <div className="section-label recent-label">ON YOUR SHELF <button className="icon-button" aria-label="Paste text" title="Paste text" onClick={openTextReader}><Plus size={15} /></button></div>
      <div className="recent-documents">{documents.slice(0, 7).map(item => <div className="shelf-row" key={item.id}><button className={`recent-document ${activeId === item.id && view === 'reader' ? 'current' : ''}`} onClick={() => selectDocument(item)}><span className={`file-icon ${item.kind.toLowerCase()}`}><FileText size={17} /></span><span><b>{item.title}</b><small>{item.kind} <i>·</i> {durationLabel(item.wordCount)} listen</small></span></button><button className="icon-button shelf-remove" aria-label={`Remove ${item.title} from shelf`} title="Remove from library" disabled={exporting} onClick={() => { setLibraryOpen(false); void removeDocument(item); }}><Trash2 size={14} /></button></div>)}</div>
      <div className="sidebar-bottom"><div className="local-card"><span className="little-star">✦</span><b>A voice. A little company.</b><p>Turn the words you love into<br />something you can listen to.</p><span><LockKeyhole size={12} /> Your library stays on this device</span></div>
        <button className="nav-item" onClick={() => { setLibraryOpen(false); setModal('settings'); }}><Settings2 size={18} /> Settings</button><button className="nav-item" onClick={() => { setLibraryOpen(false); setModal('help'); }}><CircleHelp size={18} /> A little help <span className="version">v1.0.12</span></button>
      </div>
    </aside></dialog>

    <div className="workspace">
      {importing && <div className="import-status" role="status"><LoaderCircle className="spin" size={15} /><span>{importStatus}</span><button className="text-button" onClick={() => { importAbort.current?.abort(); setImportStatus('Cancelling import…'); }}>Cancel import</button></div>}
      <header className="topbar"><div className="topbar-left"><button className="panel-toggle library-toggle" aria-label="Menu" aria-expanded={libraryOpen} aria-controls="library-sidebar" title="Library, bookmarks and settings" onClick={toggleLibrary}><Menu size={18} /><span>Menu</span></button>{view === 'reader' && doc ? <div className="reader-document-heading"><h1 title={doc.title}>{doc.title}</h1><div className="document-meta"><span className={`type-pill ${doc.kind.toLowerCase()}`}>{doc.kind}</span><span>{totalWords.toLocaleString()} words</span><span className="meta-dot">·</span><span>{durationLabel(totalWords, speed)} listen</span>{doc.kind === 'PDF' && <><span className="meta-dot">·</span><span>{doc.pageCount} pages</span></>}</div></div> : <div className="breadcrumb"><Headphones size={17} /><span>Your listening room</span><ChevronRight size={14} /><b>{view === 'reader' ? 'Reader' : view === 'library' ? 'My library' : view === 'exports' ? 'Audio exports' : 'Bookmarks'}</b></div>}</div><div className="topbar-actions"><span className="privacy-badge"><span /> Private. On your device.</span><button hidden={view === 'exports'} className="panel-toggle" aria-label={voiceVisible ? 'Hide voice panel' : 'Show voice panel'} aria-expanded={voiceVisible} aria-controls="voice-panel" title={`Narrator · ${voice.name}`} onClick={toggleVoicePanel}><AudioLines size={17} /><span>Voice</span></button><button className="icon-button" aria-label="Enter full screen" title="Full screen · F11" disabled={!doc || view !== 'reader'} onClick={() => void toggleFullScreen()}><Maximize2 size={17} /></button>{view === 'reader' && doc && <div className="document-tools"><button className="icon-button" aria-label="Close document" title="Close document · keep on shelf" disabled={exporting} onClick={() => { flushReading(); player.stop(); stopPreview(); clearSpeechCache(); setOpenText(undefined); setActiveId(''); setView('library'); }}><X size={19} /></button><button className="icon-button" aria-label="Remove current document" title="Remove from library · original file stays on disk" disabled={exporting} onClick={() => void removeDocument(activeItem!)}><Trash2 size={17} /></button></div>}</div></header>
      <div className="workspace-body">
        <main className="main-panel">
          {view === 'reader' && opening ? <div className="empty-state"><LoaderCircle className="spin" size={28} /><p>Opening {activeItem?.title || 'document'}…</p></div> : view === 'reader' && doc ? <>

            <div className="reading-toolbar"><div className="view-switch"><button className={!original ? 'active' : ''} onClick={() => switchReaderView(false)}><BookOpen size={15} /> Reading view</button><button className={original ? 'active' : ''} title={doc.kind === 'PDF' ? 'Original PDF pages' : 'Book layout with chapters and sections'} onClick={() => switchReaderView(true)}><FileText size={15} /> Document view</button></div><div className="reading-actions"><label className="speech-cue-control"><span>Speech cue</span><select aria-label="Speech cue" value={speechCue} onChange={event => setSpeechCue(event.target.value === 'underline' ? 'underline' : 'highlight')}><option value="highlight">Highlight</option><option value="underline">Underline</option></select></label><button className="icon-button" aria-label="Search document" title="Search document" onClick={() => { setShowSearch(!showSearch); setSearch(''); }}><Search size={17} /></button>{nativePdf ? <div className="pdf-zoom"><button className="icon-button compact" aria-label="Zoom out PDF" disabled={pdfZoom <= .5} onClick={() => { capturePanelAnchor(); setPdfZoom(value => Math.max(.5, value - .25)); }}><Minus size={14} /></button><select aria-label="PDF zoom" value={pdfZoom} onChange={event => { capturePanelAnchor(); setPdfZoom(Number(event.target.value)); }}>{[.5,.75,1,1.25,1.5,1.75,2].map(value => <option key={value} value={value}>{value === 1 ? 'Fit width' : `${Math.round(value * 100)}%`}</option>)}</select><button className="icon-button compact" aria-label="Zoom in PDF" disabled={pdfZoom >= 2} onClick={() => { capturePanelAnchor(); setPdfZoom(value => Math.min(2, value + .25)); }}><Plus size={14} /></button></div> : <><div className="toolbar-divider" /><button className="font-toggle" title="Change typeface" aria-label="Change typeface" onClick={() => { capturePanelAnchor(); setFontTheme(fontTheme === 'serif' ? 'sans' : 'serif'); }}>Aa</button><button className="icon-button compact" aria-label="Smaller text" disabled={fontSize <= 15} onClick={() => { capturePanelAnchor(); setFontSize(s => Math.max(15, s - 1)); }}><Minus size={14} /></button><button className="icon-button compact" aria-label="Larger text" disabled={fontSize >= 28} onClick={() => { capturePanelAnchor(); setFontSize(s => Math.min(28, s + 1)); }}><Plus size={14} /></button></>}<div className="toolbar-divider" /><button className="icon-button" aria-label="Bookmark audio position" title="Bookmark audio position" onClick={() => toggleBookmark(doc.position)}><Headphones size={16} /></button><button className={`icon-button ${viewedBookmark ? 'is-bookmarked' : ''}`} aria-label={viewedBookmark ? 'Remove bookmark' : 'Bookmark viewed passage'} title="Bookmark the viewed passage" disabled={bookmarkPosition < 0} onClick={() => toggleBookmark()}><Bookmark size={17} fill={viewedBookmark ? 'currentColor' : 'none'} /></button></div></div>
            {showSearch && <div className="search-bar"><Search size={16} /><input autoFocus placeholder="Find a word or phrase…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search document text" /><span aria-live="polite">{search ? nativePdf ? matches.length ? `${Math.min(searchIndex + 1, matches.length)} of ${matches.length}${matches.length === 2000 ? '+' : ''} matches` : 'No matches' : `${doc.segments.filter(s => s.text.toLowerCase().includes(search.toLowerCase())).length} passages` : ''}</span>{nativePdf && <><button className="icon-button" aria-label="Previous search match" disabled={!matches.length} onClick={() => setSearchIndex(index => (index + matches.length - 1) % matches.length)}><ChevronUp size={16} /></button><button className="icon-button" aria-label="Next search match" disabled={!matches.length} onClick={() => setSearchIndex(index => (index + 1) % matches.length)}><ChevronDown size={16} /></button></>}<button className="icon-button" aria-label="Close search" onClick={() => { setShowSearch(false); setSearch(''); }}><X size={16} /></button></div>}
            <div className="reader-navigation-bar">
            <LocationControls locations={locations} current={currentLocation?.key || ''} pdf={doc.kind === 'PDF'} onNavigate={navigateToLocation} open={navigationVisible} onToggle={toggleNavigation} />
            <div className="audio-navigation"><span><Headphones size={13} /> {doc.kind === 'PDF' ? `Audio on page ${doc.segments[doc.position]?.page || 1}` : `Audio at passage ${doc.position + 1}`}</span><button className="text-button" onClick={goToAudio}>Go to audio</button><button className={`follow-audio ${followAudio ? 'enabled' : ''}`} aria-pressed={followAudio} onClick={toggleFollowAudio} title="Keep the current audio in view. Scrolling or changing pages turns following off."><span aria-hidden="true">{followAudio ? <Check size={12} /> : null}</span>Follow audio</button></div>
            </div>
            <div className={`reader-body ${navigationVisible ? 'navigation-open' : ''}`}>
            {navigationVisible && <><button className="navigation-backdrop" aria-label="Dismiss document navigation" onClick={closeNavigation} /><DocumentNavigation key={doc.id} documentId={doc.id} locations={locations} contents={chapters} current={sidebarCurrent} audio={sidebarAudio} pageCurrent={currentLocation?.key || ''} pageAudio={audioLocation?.key} pdf={doc.kind === 'PDF'} source={doc.navigationSource} loading={findingTopics} onRebuild={rebuildNavigation} onNavigate={navigateToLocation} onClose={closeNavigation} /></>}
            <div className="reader-scroll" ref={readerScroll} onWheel={() => setFollowAudio(false)} onTouchMove={() => setFollowAudio(false)} onPointerDown={event => { if (event.target === event.currentTarget) setFollowAudio(false); }} onKeyDownCapture={event => { if (['PageDown', 'PageUp', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' '].includes(event.key)) setFollowAudio(false); }}>
              {original && doc.kind === 'PDF' ? <><div className="pdf-pagination"><button className="icon-button" disabled={pdfPage <= 1} aria-label="Previous PDF page" onClick={() => navigateToLocation(`page-${pdfPage - 1}`)}><ChevronLeft size={18} /></button><span>Page {pdfPage} of {doc.pageCount}</span><button className="icon-button" disabled={pdfPage >= doc.pageCount} aria-label="Next PDF page" onClick={() => navigateToLocation(`page-${pdfPage + 1}`)}><ChevronRight size={18} /></button><button className="text-button" onClick={() => { const index = doc.segments.findIndex(s => s.page === pdfPage); if (index >= 0) player.playFrom(index); else notify('This page has no selectable text.'); }}>Listen from this page</button></div><PdfPage documentId={doc.id} pageNumber={pdfPage} onPage={setPdfPage} jumpTarget={browseRequest} spokenParts={player.spokenParts} segments={doc.segments} zoom={pdfZoom} searchMatches={matches} searchMatch={currentMatch} onWord={readPdfWord} /></> : <article className={`reading-paper ${fontTheme} ${original ? 'document-paper' : ''}`} aria-label={original ? 'Document view' : 'Reading view'} style={{ '--reader-size': `${fontSize}px` } as React.CSSProperties}>
                <div className="paper-topline"><span>THE READING ROOM</span><span>{doc.kind === 'PDF' ? 'ORIGINAL PDF PAGES' : original ? 'DOCUMENT VIEW · SECTIONS' : 'DOCUMENT SECTIONS'}</span></div>
                {readingSections}
                {search && !doc.segments.some(s => s.text.toLowerCase().includes(search.toLowerCase())) && <p className="empty-message">No passages found. Try a different phrase.</p>}
                <div className="paper-end">✦</div>
              </article>}
              <p className="reading-hint"><Headphones size={13} /> Click any word to listen from there. Drag to select text.</p>
            </div>
            </div>
          </> : view === 'exports' ? <ExportJobs canCreate={!!doc} onBack={() => setView(doc ? 'reader' : 'library')} onCreate={() => { setExportResult(undefined); setModal('export'); }} /> : view === 'bookmarks' ? <>
            <div className="document-heading"><div><span className="eyebrow">WORDS TO COME BACK TO</span><h1>Your bookmarks</h1><p className="subtext">Good ideas deserve a second listen.</p></div><button className="secondary collection-back" onClick={backFromBookmarks}><ArrowLeft size={16} />{bookmarksFrom.current.view === 'reader' && doc ? 'Back to reading' : 'Back to library'}</button></div>
            <div className="library-scroll">{documents.flatMap(item => item.bookmarks.map(index => <button key={`${item.id}-${index}`} className="bookmark-card" onClick={() => { if (item.id !== activeId) selectDocument(item); else { setSearch(''); setShowSearch(false); setView('reader'); } setBookmarkRequest({ id: item.id, index }); }}><Bookmark size={20} /><span><b>{item.title}</b><p>{item.bookmarkPreviews[index]?.text}</p><small>Passage {index + 1} · Page {item.bookmarkPreviews[index]?.page}</small></span><ArrowRight size={18} /></button>))}{!documents.some(item => item.bookmarks.length) && <div className="empty-state"><Bookmark size={36} /><h2>Keep a little of what you love.</h2><p>Use the bookmark button while reading to save a passage here.</p></div>}</div>
          </> : <>
            <div className="document-heading"><div><span className="eyebrow">A SHELF FULL OF POSSIBILITIES</span><h1>Your words. Your rhythm.</h1><p className="subtext">Everything you want to read, ready to be heard.</p></div>{doc && <button className="secondary collection-back" onClick={() => setView('reader')}><ArrowLeft size={16} />Back to reading</button>}</div>
            <div className="library-scroll"><button className="upload-area" onClick={() => input.current?.click()} disabled={importing || exporting}><span className="upload-circle">{importing ? <LoaderCircle className="spin" /> : <Upload />}</span><b>{importing ? 'Getting your words ready…' : 'Drop a document. Find your next listen.'}</b><p>PDF, Word, EPUB, text or Markdown <span>·</span> Up to 50 MB</p><span className="secondary">Browse files <ArrowRight size={15} /></span></button><div className="library-list-heading"><h2>On your shelf <span>{documents.length}</span></h2><button className="text-button" onClick={openTextReader}><Plus size={15} /> Paste text instead</button></div><div className="library-search"><Search size={16} /><input aria-label="Search library" placeholder="Find a document…" value={librarySearch} onChange={e => setLibrarySearch(e.target.value)} /></div>
              <div className="document-grid">{libraryItems.map(item => <div className="document-card" key={item.id}><button className="document-card-main" onClick={() => selectDocument(item)}><span className={`book-cover ${item.kind.toLowerCase()}`}><span>cadence library</span><BookOpen size={29} strokeWidth={1} /><b>{item.title}</b><small>{item.kind}</small></span><h3>{item.title}</h3><p>{item.kind} <span>·</span> {durationLabel(item.wordCount)} listen</p><span className="mini-progress"><i style={{ width: `${item.position / Math.max(1, item.segmentCount - 1) * 100}%` }} /></span></button><button className="icon-button remove-document" aria-label={`Remove ${item.title}`} title="Remove from library" disabled={exporting} onClick={() => void removeDocument(item)}><Trash2 size={15} /></button></div>)}</div>{!libraryItems.length && <p className="empty-message">{librarySearch ? 'No documents match your search.' : 'Your listening library starts here.'}</p>}
            </div>
          </>}
        </main>

        <aside className="voice-panel" id="voice-panel" aria-label="Voice selection" hidden={!voiceVisible}><div className="voice-panel-title"><h2>Your narrator</h2><button className="icon-button" aria-label="Close voice panel" title="Hide voice panel" onClick={toggleVoicePanel}><PanelRightClose size={17} /></button></div><div className="voice-panel-scroll"><p className="voice-intro">A voice that feels like good company.</p>
          <div className="selected-voice"><div className="selected-voice-top"><VoiceAvatar voice={voice} large /><div><h3>{voice.name}</h3><p>{voice.accent} {voice.gender && '·'} {voice.gender}</p></div><span className="voice-selected-check"><Check size={14} /></span></div><p>{voice.description}</p><button className="preview-button" onClick={() => void previewVoice()} disabled={exporting || !voiceId}>{previewing ? <LoaderCircle size={14} className="spin" /> : <Play size={13} fill="currentColor" />}{previewing ? 'Stop preview' : 'Listen to a preview'}<Waveform small active={previewing} theme={theme} /></button></div>
          <div className="voices-heading"><span className="section-label">FIND YOUR VOICE</span><select aria-label="Filter voices" value={voiceFilter} onChange={e => setVoiceFilter(e.target.value)}><option>All voices</option><option>Curated voices</option><option>American</option><option>British</option><option>Female</option><option>Male</option></select></div>
          <details className="voice-blender"><summary>Blend voices · experimental</summary><label className="field-label">First voice<select aria-label="First blend voice" value={blendPrimary} disabled={exporting} onChange={event => setBlendPrimary(event.target.value)}>{availableVoices.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="field-label">Second voice<select aria-label="Second blend voice" value={blendSecondary} disabled={exporting} onChange={event => setBlendSecondary(event.target.value)}>{availableVoices.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="field-label">First voice · {blendRatio}%<input aria-label="Voice blend ratio" type="range" min="0" max="100" step="5" value={blendRatio} disabled={exporting} onChange={event => setBlendRatio(Number(event.target.value))} /></label><button className="secondary" disabled={exporting} onClick={() => { const selected = blendVoice(blendPrimary, blendSecondary, blendRatio); if (selected) setLocalVoice(selected.id); }}>Use blend</button></details>
          <div className="voice-list">{filteredVoices.map(item => <button key={item.id} className={`voice-option ${voiceId === item.id ? 'selected' : ''}`} onClick={() => setLocalVoice(item.id)} disabled={exporting}><VoiceAvatar voice={item} /><span><b>{item.name}</b><small>{item.accent} <i>·</i> {item.gender}</small></span>{voiceId === item.id ? <Check size={16} className="check" /> : <span className="voice-radio" />}</button>)}{!filteredVoices.length && <p className="empty-message">No voices match this filter.</p>}</div>
          <div className="voice-footer"><ShieldCheck size={16} /><span>Natural voices. No subscriptions.<small>Your words stay on your computer.</small></span></div></div>
        </aside>
      </div>

      {focusMode && doc && <FocusControls playing={playing} busy={busy} disabled={exporting || !voiceId} page={currentLocation?.number || 1} count={locations.length} pdf={doc.kind === 'PDF'} original={original} pdfZoom={pdfZoom} searchOpen={showSearch} onSearch={() => setShowSearch(value => !value)} onPdfZoom={value => { capturePanelAnchor(); setPdfZoom(value); }} canBookmark={bookmarkPosition >= 0} speechCue={speechCue} onSpeechCue={setSpeechCue} speed={speed} voiceOpen={voiceVisible} navigationOpen={navigationVisible} bookmarked={viewedBookmark} onExit={() => void toggleFullScreen()} onToggle={togglePlayback} onSkip={player.seekSeconds} onPage={number => { const location = locations[number - 1]; if (location) navigateToLocation(location.key); }} onNavigate={toggleNavigation} onVoice={toggleVoicePanel} onSpeed={setSpeed} onOriginal={() => switchReaderView(!original)} onBookmark={() => toggleBookmark()} onAudio={goToAudio} followAudio={followAudio} onFollow={toggleFollowAudio} />}
      <div className={`player-dock ${playerExpanded ? 'expanded' : ''}`} data-manual-hidden={playerActive.manualHidden} onFocusCapture={event => setPlayerFocused((event.target as HTMLElement).matches(':focus-visible'))} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPlayerFocused(false); }}>
      <button className="player-reveal" aria-label={playerExpanded ? 'Hide playback controls' : 'Show playback controls'} aria-controls="playback-controls" aria-expanded={playerExpanded} title={playerExpanded ? 'Hide player until your next click or key press' : 'Show player'} onClick={() => { if (playerExpanded) { setPlayerFocused(false); playerActive.hide(); } else playerActive.show(); }}><ChevronUp size={13} /><span>{playerExpanded ? 'Hide player' : 'Playback'}</span></button>
      <footer id="playback-controls" aria-label="Playback controls" aria-hidden={!playerExpanded} inert={!playerExpanded} className="player" data-buffered-seconds={Math.floor(player.bufferedSeconds)}><div className="player-top"><div className="player-track"><div className="now-playing-art"><Waveform active={playing && playerExpanded} theme={theme} /></div><div className="now-playing"><span>{busy ? (modelState === 'loading' ? `Preparing voice model${modelProgress !== undefined ? ` · ${Math.round(modelProgress)}%` : '…'}` : 'Preparing first phrase…') : playing ? 'NOW PLAYING' : player.state === 'paused' ? 'TAKE YOUR TIME' : 'READY WHEN YOU ARE'} {playing && <span className="playing-dot" />}</span><b>{doc?.title || 'Your next good listen'}</b><small>{voice.name} <i>·</i> Local neural</small></div></div><div className="playback-controls"><button className="icon-button" aria-label="Previous passage" title="Previous passage" disabled={!doc || exporting} onClick={() => player.jump((doc?.position || 0) - 1)}><SkipBack size={18} /></button><button className="jump-button" aria-label="Back 15 seconds" title="Back 15 seconds" disabled={!doc || exporting} onClick={() => player.seekSeconds(-15)}><span>↶</span><small>15</small></button><button className="play-button" aria-label={busy ? 'Cancel loading' : playing ? 'Pause narration' : 'Play narration'} disabled={!doc || exporting || !voiceId} onClick={togglePlayback}>{busy ? <LoaderCircle className="spin" size={24} /> : playing ? <Pause size={23} fill="currentColor" /> : <Play size={23} fill="currentColor" />}</button><button className="jump-button" aria-label="Forward 15 seconds" title="Forward 15 seconds" disabled={!doc || exporting} onClick={() => player.seekSeconds(15)}><span>↷</span><small>15</small></button><button className="icon-button" aria-label="Next passage" title="Next passage" disabled={!doc || exporting} onClick={() => player.jump((doc?.position || 0) + 1)}><SkipForward size={18} /></button><label className="player-speed" title="Narration speed"><input type="range" min="0.65" max="1.75" step="0.05" value={speed} aria-label="Narration speed" onChange={e => setSpeed(Number(e.target.value))} /><span>{speed.toFixed(2).replace(/0$/, '')}×</span></label></div><div className="player-extras"><label className="sleep-control" title="Sleep timer"><Timer size={17} /><select aria-label="Sleep timer" value={sleep} onChange={e => setSleep(Number(e.target.value))}><option value={0}>Sleep timer</option><option value={5}>5 minutes</option><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={60}>60 minutes</option></select></label><button className="export-button" onClick={() => { setExportResult(undefined); setModal('export'); }} disabled={!doc || exporting}><ArrowDownToLine size={16} /> Export audio</button></div></div><div className="player-timeline"><span>{clockTime(elapsed / speed)}</span><input type="range" min={0} max={100} step={.1} value={progress} aria-label="Reading progress" disabled={!doc || exporting} style={{ '--progress': `${progress}%` } as React.CSSProperties} onChange={e => { const target = Number(e.target.value) / 100 * totalWords; let sum = 0; let index = 0; while (doc && index < doc.segments.length - 1 && sum + doc.segments[index].text.split(/\s+/).length < target) { sum += doc.segments[index].text.split(/\s+/).length; index++; } player.jump(index); }} /><span>~{clockTime(estimatedSeconds / speed)}</span><span className="timeline-label">{Math.round(progress)}% through <i>·</i> {playing || player.state === 'paused' ? `${Math.floor(player.bufferedSeconds)}s ready` : 'Your place is saved'}</span></div></footer>
      </div>
    </div>

    {modal === 'paste' && <Modal title="Text reader" subtitle="Paste something to listen to. No document or file needed." onClose={closeTextReader}><div className="text-reader"><label className="field-label">Your text<textarea ref={noteInput} aria-label="Your text" rows={9} placeholder="Paste or write your text here…" value={noteText} disabled={noteSaving} onChange={e => setNoteText(e.target.value)} /></label><label className="field-label">Title (optional)<input aria-label="Document title" placeholder="Pasted text" value={noteTitle} disabled={noteSaving} onChange={e => setNoteTitle(e.target.value)} /></label><p className="field-hint">Saved locally to your library, with the same voices, highlighting, bookmarks and audio export as your documents.</p>{noteError && <p className="export-error" role="alert">{noteError}</p>}<div className="modal-footer"><span>{noteText.trim() ? noteText.trim().split(/\s+/).length : 0} words</span><div className="text-reader-actions"><button className="secondary" onClick={() => void addNote()} disabled={noteSaving || exporting || !noteText.trim()}>Add to my library</button><button className="primary" onClick={() => void addNote(true)} disabled={noteSaving || exporting || !voiceId || !noteText.trim()}>{noteSaving ? <LoaderCircle size={16} className="spin" /> : <Play size={16} />}Read aloud</button></div></div></div></Modal>}
    {modal === 'settings' && <Modal title="Make yourself at home." subtitle="Your reading room, your way of listening." onClose={() => setModal(null)}><div className="settings-section"><h3><Palette size={18} /> Appearance</h3><label className="field-label">Theme<select aria-label="App theme" value={theme} onChange={event => setTheme(event.target.value === 'midnight' || event.target.value === 'graphite' ? event.target.value : 'slate')}><option value="slate">Slate + accents</option><option value="midnight">Midnight Ink</option><option value="graphite">Graphite &amp; Copper</option></select></label><p className="field-hint">Switch any time. Your choice is saved on this device. Original PDF pages keep their original colours.</p></div><div className="settings-section"><h3><AudioLines size={18} /> Local neural voices <span className="free-badge">Always free</span></h3><p>23 natural English voices, including the original eight curated choices, powered by Kokoro. Speech is generated privately on this computer. The model downloads once (about 326 MB), if it isn’t already bundled.</p><button className="secondary" onClick={() => void prepareModel()} disabled={modelState === 'loading'}>{modelState === 'ready' ? <CheckCheck size={17} /> : modelState === 'loading' ? <LoaderCircle className="spin" size={17} /> : <ArrowDownToLine size={17} />}{modelState === 'ready' ? 'Local voices are ready' : modelState === 'loading' ? `Preparing voices${modelProgress !== undefined ? ` · ${Math.round(modelProgress)}%` : '…'}` : 'Prepare local voices'}</button></div><div className="settings-section"><h3><Headphones size={18} /> Smooth playback</h3><p>Quick start plays the first phrase as soon as it is ready. Upcoming phrases prepare while you listen, and local voices warm up when you open the app.</p><label className="field-label">When to start speaking<select aria-label="Playback buffer" value={startupSeconds} onChange={e => setStartupSeconds(Number(e.target.value))}><option value={0}>Quick start · first phrase ready</option><option value={3}>Small reserve · 3 seconds of audio</option><option value={8}>Extra reserve · 8 seconds of audio</option></select></label><p className="field-hint">Quick start is the default. A small reserve can help on slower computers. Up to 12 upcoming phrases prepare in the background.</p></div></Modal>}
    {modal === 'export' && <Modal title="Take your listen with you." subtitle="Create an offline audiobook, or save a short WAV." onClose={() => { if (exporting) { exportCancelled.current = true; } setModal(null); }}><AudiobookExport onManage={openExportManager} document={doc} voiceId={voiceId} wavBusy={exporting} onClose={() => setModal(null)} wav={<><div className="export-summary"><VoiceAvatar voice={voice} large /><div><b>{doc?.title}</b><span>{voice.name} · Local neural voice · WAV</span></div></div><label className="field-label">What would you like to export?<select value={exportRange} onChange={e => setExportRange(e.target.value as 'all' | 'remaining')} disabled={exporting}><option value="all">The entire document</option><option value="remaining">From my current passage to the end</option></select></label><p className="field-hint">WAV uses the voice’s natural pace (1×). This short-export tool cannot resume after closing Cadence; choose M4B for saved, resumable audiobooks.</p>{exporting && <div className="export-progress"><progress max={100} value={exportProgress} /><span>Creating your audio · {exportProgress}%</span></div>}<div className="modal-footer"><button className="text-button" onClick={() => { exportCancelled.current = true; setModal(null); }}>{exporting ? 'Cancel export' : 'Close'}</button>{exportResult ? <button className="primary" onClick={async () => { try { const bytes = new Uint8Array(await (await fetch(exportResult.url)).arrayBuffer()); if (await window.cadence?.saveAudio(bytes, exportResult.filename)) notify('Your audio has been saved.'); } catch (error) { notify((error as Error).message, true); } }}><ArrowDownToLine size={16} /> Save WAV</button> : <button className="primary" disabled={exporting || !voiceId} onClick={() => void exportAudio()}>{exporting ? <LoaderCircle size={16} className="spin" /> : <AudioLines size={16} />}{exporting ? 'Creating audio…' : 'Create audio file'}</button>}</div></>} /></Modal>}
    {modal === 'help' && <Modal title="A little help." subtitle="Less setup. More listening." onClose={() => setModal(null)}><div className="help-item"><span>01</span><div><h3>Bring something to read</h3><p>Import a PDF, DOCX, EPUB, TXT or Markdown file, or paste text. PDFs need selectable text; scanned pages need OCR first.</p></div></div><div className="help-item"><span>02</span><div><h3>Find your narrator</h3><p>Choose a local neural voice and try a preview. On first use, the free voice model may need to download. Local narration currently supports English.</p></div></div><div className="help-item"><span>03</span><div><h3>Make yourself comfortable</h3><p>Press play, or click any word to start reading from that exact word. Your library, bookmarks and reading position are saved automatically on this device.</p></div></div><div className="keyboard-hints"><span><kbd>Space</kbd> Play / pause</span><span><kbd>←</kbd> <kbd>→</kbd> Skip 15 seconds</span></div><p className="field-hint">Reading times and progress are estimates. Choose Highlight or Underline in Speech cue to follow the spoken sentence or phrase. Document view keeps original PDF pages and gives other documents a book layout with chapters and sections.</p></Modal>}
    {removed && <div className="toast removal-toast" role="status"><span>Removed “{removed.title}” from your library.</span><button className="undo-button" onClick={undoRemoval}>Undo</button><button className="icon-button" aria-label="Dismiss removal notification" title="Finish removal" onClick={() => void finishRemoval().catch(() => {})}><X size={16} /></button></div>}
    {toast && <div className={`toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <CircleHelp size={18} /> : <Check size={18} />}<span>{toast.message}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast(undefined)}><X size={16} /></button></div>}
    {dragging && <div className="drop-overlay"><Upload size={40} /><h2>Make it your next listen.</h2><p>Drop your documents here</p></div>}
  </div>;

}
