import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, ArrowDownToLine, ArrowLeft, ArrowRight, BookOpen, Bookmark, Check, CheckCheck, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, CircleHelp, FileText, FolderOpen, Headphones, Library, LoaderCircle, LockKeyhole, Maximize2, Minus, MoreHorizontal, PanelLeftClose, PanelLeftOpen, PanelRightClose, Pause, Play, Plus, Search, Settings2, ShieldCheck, SkipBack, SkipForward, Timer, Trash2, Upload, Volume2, X } from 'lucide-react';
import { importDocument, makeDocument, welcomeDocument, durationLabel, readPdfNavigation } from './documents';
import { loadLibrary, saveLibrary, addDocument, deleteDocument, openDocumentText, loadPdfBytes } from './library';
import { speechPlan } from './speechPlan';
import { localVoices } from './voices';
import { usePlayer } from './usePlayer';
import { useIdlePlayer } from './useIdlePlayer';
import { clearSpeechCache, decodeSpeech, synthesize, wavBytes, clockTime } from './audio';
import PdfPage from './PdfPage';
import ReadingSection from './ReadingSection';
import FocusControls from './FocusControls';
import DocumentNavigation, { LocationControls } from './DocumentNavigation';
import { documentLocations, locationForPosition, chapterLocations, chapterAtPage, flattenLocations } from './locations';
import { NAVIGATION_VERSION, groupOpeningPages, textTopics } from './structure';
import { lastReaderBook, removeReadingCheckpoint, type ReadingCheckpoint } from './readerSession';
import { useReaderResume } from './useReaderResume';
import type { DocumentLocation } from './locations';
import type { LibraryItem, ReaderDocument, Segment, Voice } from './types';

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose(): void; children: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement; dialog.current?.showModal(); return () => previous?.focus(); }, []);
  return <dialog ref={dialog} className="dialog" onCancel={onClose} onClick={e => { if (e.target === dialog.current) onClose(); }}>
    <div className="modal-content"><button className="icon-button modal-close" onClick={onClose} aria-label="Close dialog"><X size={19} /></button><h2>{title}</h2>{subtitle && <p className="modal-subtitle">{subtitle}</p>}{children}</div>
  </dialog>;
}
function Waveform({ active = false, small = false }: { active?: boolean; small?: boolean }) {
  return <span aria-hidden="true" className={`waveform ${active ? 'active' : ''} ${small ? 'small' : ''}`}>{[12, 21, 30, 18, 36, 25, 14, 28, 20, 12, 24, 16].map((height, i) => <i key={i} style={{ height, animationDelay: `${i * .085}s` }} />)}</span>;
}
function VoiceAvatar({ voice, large = false }: { voice: Voice; large?: boolean }) {
  return <span className={`voice-avatar ${voice.color || 'sage'} ${large ? 'large' : ''}`}><AudioLines size={large ? 27 : 21} strokeWidth={1.4} /></span>;
}

export default function App() {
  const [documents, setDocuments] = useState<LibraryItem[]>([]);
  const [openText, setOpenText] = useState<{ id: string; segments: Segment[] }>();
  const [opening, setOpening] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [activeId, setActiveId] = useState('cadence-welcome');
  const [view, setView] = useState<'reader' | 'library' | 'bookmarks'>('reader');
  const [localVoice, setLocalVoice] = useState(() => localStorage.getItem('cadence-local-voice') || 'af_heart');
  const [speed, setSpeed] = useState(() => Number(localStorage.getItem('cadence-speed')) || 1);
  const [startupSeconds, setStartupSeconds] = useState(() => [0, 3, 8].includes(Number(localStorage.getItem('cadence-startup-v2'))) ? Number(localStorage.getItem('cadence-startup-v2')) : 0);
  const [fontSize, setFontSize] = useState(19);
  const [fontTheme, setFontTheme] = useState<'serif' | 'sans'>('serif');
  const [voiceFilter, setVoiceFilter] = useState('All voices');
  const [modelState, setModelState] = useState('idle');
  const [modelProgress, setModelProgress] = useState<number | undefined>();
  const [modal, setModal] = useState<'paste' | 'settings' | 'export' | 'help' | null>(null);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteText, setNoteText] = useState('');
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState('');
  const importAbort = useRef<AbortController | undefined>(undefined);
  const [toast, setToast] = useState<{ message: string; error?: boolean }>();
  const [dragging, setDragging] = useState(false);
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [original, setOriginal] = useState(false);
  const [pdfPage, setPdfPage] = useState(1);
  const [followAudio, setFollowAudio] = useState(false);
  const [revealRequest, setRevealRequest] = useState(0);
  const [navigationOpen, setNavigationOpen] = useState(() => localStorage.getItem('cadence-navigation-open') === null ? window.innerWidth >= 1280 : localStorage.getItem('cadence-navigation-open') === 'true');
  const [libraryOpen, setLibraryOpen] = useState(() => localStorage.getItem('cadence-library-open') !== 'false');
  const [voiceOpen, setVoiceOpen] = useState(() => localStorage.getItem('cadence-voice-open') !== 'false');
  const [focusMode, setFocusMode] = useState(false);
  const [focusVoiceOpen, setFocusVoiceOpen] = useState(false);
  const [focusNavigationOpen, setFocusNavigationOpen] = useState(false);
  const [playerFocused, setPlayerFocused] = useState(false);
  const [findingTopics, setFindingTopics] = useState(false);
  const [visibleLocation, setVisibleLocation] = useState('');
  const [visiblePassage, setVisiblePassage] = useState(0);
  const [browseRequest, setBrowseRequest] = useState<{ key: string; segment?: number; y?: number }>();
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
  const previewUrl = useRef<string | undefined>(undefined);
  const activeParagraph = useRef<HTMLButtonElement>(null);
  const readerScroll = useRef<HTMLDivElement>(null);
  const panelAnchor = useRef<{ element: HTMLElement; offset: number; fraction?: number } | undefined>(undefined);
  const activeItem = documents.find(d => d.id === activeId);
  const doc = useMemo<ReaderDocument | undefined>(() => activeItem && openText?.id === activeId ? { ...activeItem, segments: openText.segments } : undefined, [activeItem, openText, activeId]);
  const locations = useMemo(() => documentLocations(doc), [doc?.id, doc?.segments, doc?.pageCount, doc?.pageLabels]);
  const effectiveTopics = useMemo(() => doc && doc.navigationVersion === NAVIGATION_VERSION ? doc.topics || [] : doc ? (doc.kind === 'PDF' ? groupOpeningPages(textTopics(doc.segments, true)) : textTopics(doc.segments)) : [], [doc?.id, doc?.topics, doc?.navigationVersion, doc?.segments]);
  const chapters = useMemo(() => chapterLocations(doc ? { ...doc, topics: effectiveTopics } : undefined, locations), [doc?.id, effectiveTopics, locations]);
  const chapterTargets = useMemo(() => new Map(flattenLocations(chapters).map(entry => [entry.key, entry])), [chapters]);
  const currentLocation = locations.find(location => location.key === (original ? `page-${pdfPage}` : visibleLocation)) || locations[0];
  const audioLocation = locationForPosition(locations, doc?.position || 0);
  const sidebarCurrent = chapterAtPage(chapters, currentLocation?.page || 1, original ? undefined : visiblePassage);
  const sidebarAudio = chapterAtPage(chapters, audioLocation?.page || 1, doc?.position);
  const voices = localVoices;
  const voiceId = localVoice;
  const voice = voices.find(v => v.id === voiceId) || voices[0] || { id: '', name: 'Choose a voice', accent: '', gender: '', description: '' };
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
  const voiceVisible = focusMode ? focusVoiceOpen : voiceOpen;
  const navigationVisible = focusMode ? focusNavigationOpen : navigationOpen;
  const restoreReading = useCallback((location: DocumentLocation, point: ReadingCheckpoint) => {
    setFollowAudio(false); setOriginal(point.original); setPdfPage(point.page);
    setVisibleLocation(location.key); setVisiblePassage(point.segment ?? location.start);
    setBrowseRequest({ key: location.key, ...(!point.original && point.segment !== undefined ? { segment: point.segment } : {}) });
  }, []);
  const { flush: flushReading, interrupt: interruptReadingResume } = useReaderResume({ doc, locations, scroll: readerScroll, reading: view === 'reader', original, pdfPage, visibleLocation, visiblePassage, search, restore: restoreReading, onError: () => notify('Your reading position could not be saved. Check available disk space.', true) });
  const closingSnapshot = useRef({ loaded, documents }); closingSnapshot.current = { loaded, documents };
  const librarySaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closingApp = useRef(false);
  useEffect(() => window.cadence?.onBeforeClose(async () => {
    closingApp.current = true;
    clearTimeout(librarySaveTimer.current);
    flushReading();
    const snapshot = closingSnapshot.current;
    if (snapshot.loaded) await saveLibrary(snapshot.documents);
  }), [flushReading]);

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
  useEffect(() => { if (loaded && (!activeId || activeItem)) localStorage.setItem('cadence-document', activeId); setOriginal(false); setSearch(''); setShowSearch(false); setPdfPage(1); setFollowAudio(false); }, [activeId, loaded]);
  useEffect(() => { localStorage.setItem('cadence-local-voice', localVoice); localStorage.setItem('cadence-speed', String(speed)); }, [localVoice, speed]);
  useEffect(() => { localStorage.setItem('cadence-startup-v2', String(startupSeconds)); }, [startupSeconds]);
  useEffect(() => { localStorage.setItem('cadence-library-open', String(libraryOpen)); }, [libraryOpen]);
  useEffect(() => { localStorage.setItem('cadence-navigation-open', String(navigationOpen)); }, [navigationOpen]);
  useEffect(() => { localStorage.setItem('cadence-voice-open', String(voiceOpen)); }, [voiceOpen]);
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
    if (doc.navigationVersion === NAVIGATION_VERSION && navigationRefresh !== doc.id) { setFindingTopics(false); return; }
    const abort = new AbortController();
    const id = doc.id;
    setFindingTopics(true);
    void loadPdfBytes(id).then(bytes => readPdfNavigation(bytes, abort.signal, doc.segments)).then(metadata => { if (!abort.signal.aborted) { setDocuments(items => items.map(item => item.id === id ? { ...item, ...metadata } : item)); setFindingTopics(false); setNavigationRefresh(undefined); } }).catch(() => { if (!abort.signal.aborted) { setFindingTopics(false); setNavigationRefresh(undefined); } });
    return () => { abort.abort(); };
  }, [doc?.id, doc?.navigationVersion, navigationRefresh]);
  // Track the page/section at the top of the reading viewport, independently
  // of the spoken passage. Scrolling never changes playback position.
  useEffect(() => {
    const scroller = readerScroll.current;
    if (!scroller || original || view !== 'reader') return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const probe = scroller.getBoundingClientRect().top + Math.min(80, scroller.clientHeight / 5);
      const sections = Array.from(scroller.querySelectorAll<HTMLElement>('[data-location-key]'));
      let selected = sections[0];
      for (const section of sections) { if (section.getBoundingClientRect().top <= probe) selected = section; else break; }
      if (sections.length && scroller.scrollTop > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) selected = sections[sections.length - 1];
      if (selected) {
        setVisibleLocation(selected.dataset.locationKey!);
        const passages = Array.from(selected.querySelectorAll<HTMLElement>('[data-passage-index]'));
        let visible = passages[0];
        const passageProbe = scroller.getBoundingClientRect().top + 24;
        for (const passage of passages) { if (passage.getBoundingClientRect().top <= passageProbe) visible = passage; else break; }
        if (visible) setVisiblePassage(Number(visible.dataset.passageIndex));
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    scroller.addEventListener('scroll', schedule, { passive: true });
    const observer = new ResizeObserver(schedule); observer.observe(scroller);
    update();
    return () => { scroller.removeEventListener('scroll', schedule); observer.disconnect(); cancelAnimationFrame(frame); };
  }, [doc?.id, locations, original, search, view]);
  const capturePanelAnchor = useCallback(() => {
    const scroller = readerScroll.current;
    if (!scroller) return;
    const viewport = scroller.getBoundingClientRect();
    if (original) {
      const canvas = scroller.querySelector<HTMLCanvasElement>('.pdf-page canvas');
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
  }, [original, currentLocation?.key]);
  const playerActive = useIdlePlayer(`${focusMode}:${activeId}`, capturePanelAnchor);
  const playerExpanded = playerActive || playerFocused;
  useLayoutEffect(() => {
    const anchor = panelAnchor.current, scroller = readerScroll.current;
    panelAnchor.current = undefined;
    if (anchor?.element.isConnected && scroller) {
      const bounds = anchor.element.getBoundingClientRect();
      scroller.scrollTo({ top: scroller.scrollTop + bounds.top + bounds.height * (anchor.fraction || 0) - scroller.getBoundingClientRect().top - anchor.offset, behavior: 'instant' });
    }
  });
  const closeNavigation = useCallback(() => { capturePanelAnchor(); if (focusMode) setFocusNavigationOpen(false); else setNavigationOpen(false); }, [capturePanelAnchor, focusMode]);
  const toggleNavigation = useCallback(() => {
    capturePanelAnchor();
    if (focusMode) { setFocusNavigationOpen(value => !value); setFocusVoiceOpen(false); }
    else setNavigationOpen(value => !value);
  }, [capturePanelAnchor, focusMode]);
  const toggleLibrary = useCallback(() => { capturePanelAnchor(); setLibraryOpen(value => !value); }, [capturePanelAnchor]);
  const toggleVoicePanel = useCallback(() => {
    capturePanelAnchor();
    if (focusMode) { setFocusVoiceOpen(value => !value); setFocusNavigationOpen(false); }
    else setVoiceOpen(value => !value);
  }, [capturePanelAnchor, focusMode]);
  const toggleFullScreen = useCallback(async () => {
    capturePanelAnchor();
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
      setFocusMode(enabled);
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
    setFollowAudio(false); setSearch(''); setVisibleLocation(location.key); setPdfPage(location.page);
    setVisiblePassage(topic?.start ?? location.start);
    setBrowseRequest({ key: location.key, ...(topic?.targetSegment !== undefined ? { segment: topic.targetSegment } : {}), ...(topic?.y !== undefined ? { y: topic.y } : {}) });
    if (focusMode) setFocusNavigationOpen(false);
    else if (window.innerWidth < 1280) setNavigationOpen(false);
  }, [locations, chapterTargets, doc?.kind, focusMode, interruptReadingResume]);
  useEffect(() => {
    if (!browseRequest || view !== 'reader') return;
    const scroller = readerScroll.current;
    if (!scroller) return;
    if (original) { if (browseRequest.segment === undefined && browseRequest.y === undefined) scroller.scrollTo({ top: 0, behavior: 'instant' }); flushReading(); return; }
    const section = Array.from(scroller.querySelectorAll<HTMLElement>('[data-location-key]')).find(item => item.dataset.locationKey === browseRequest.key);
    const target = browseRequest.segment !== undefined ? section?.querySelector<HTMLElement>(`[data-passage-index="${browseRequest.segment}"]`) || section : section;
    if (target) scroller.scrollTo({ top: scroller.scrollTop + target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12, behavior: 'instant' });
    flushReading();
  }, [browseRequest, original, view, flushReading]);
  function switchReaderView(showOriginal: boolean) {
    interruptReadingResume();
    if (showOriginal) {
      const page = currentLocation?.page || 1;
      setPdfPage(page);
      setBrowseRequest({ key: `page-${page}`, segment: visiblePassage });
    }
    else { setSearch(''); setBrowseRequest({ key: `page-${pdfPage}` }); }
    setOriginal(showOriginal);
  }
  function revealAudio() {
    interruptReadingResume();
    const scroller = readerScroll.current;
    if (!scroller || !doc) return;
    if (original) {
      const page = doc.segments[doc.position]?.page || 1;
      setPdfPage(page); setBrowseRequest({ key: `page-${page}` });
      scroller.scrollTo({ top: 0, behavior: 'instant' });
    } else if (activeParagraph.current) {
      const passage = activeParagraph.current.getBoundingClientRect();
      const viewport = scroller.getBoundingClientRect();
      scroller.scrollTo({ top: scroller.scrollTop + passage.top - viewport.top - (scroller.clientHeight - passage.height) / 2, behavior: 'instant' });
    }
  }
  function goToAudio() { setSearch(''); setRevealRequest(value => value + 1); }
  // Browsing and listening positions are independent. Only an explicit follow
  // choice or Go to audio may move the viewport when narration advances.
  useEffect(() => { if (followAudio && (playing || busy) && view === 'reader') revealAudio(); }, [doc?.position, playing, busy, followAudio, original, view]);
  useEffect(() => { if (revealRequest) revealAudio(); }, [revealRequest]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) || target.isContentEditable || modal) return;
      if (event.code === 'Space') { event.preventDefault(); player.toggle(); }
      if (event.key === 'ArrowRight') { event.preventDefault(); player.seekSeconds(15); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); player.seekSeconds(-15); }
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, [player, modal]);
  useEffect(() => { if (!sleep) return; const timer = setTimeout(() => { player.stop(); setSleep(0); notify('Sleep timer finished. Your place is saved.'); }, sleep * 60000); return () => clearTimeout(timer); }, [sleep, player.stop, notify]);
  const stopPreview = useCallback(() => {
    previewRun.current++; previewAudio.current?.pause();
    if (previewAudio.current) { previewAudio.current.removeAttribute('src'); previewAudio.current.load(); previewAudio.current = null; }
    if (previewUrl.current) { URL.revokeObjectURL(previewUrl.current); previewUrl.current = undefined; }
    setPreviewing(false);
  }, []);
  useEffect(() => { stopPreview(); setExportResult(undefined); }, [voiceId, activeId, stopPreview]);
  useEffect(() => () => { if (exportResult) URL.revokeObjectURL(exportResult.url); }, [exportResult]);

  const selectDocument = (item: LibraryItem) => { if (exporting) return; flushReading(); player.stop(); stopPreview(); setActiveId(item.id); setView('reader'); };
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
  async function addNote() {
    try { const item = await addDocument(makeDocument(noteTitle, noteText)); setDocuments(items => [item, ...items]); selectDocument(item); setNoteTitle(''); setNoteText(''); setModal(null); } catch (error) { notify((error as Error).message, true); }
  }
  function toggleBookmark() {
    if (!doc) return;
    setDocuments(items => items.map(item => {
      if (item.id !== activeId) return item;
      const bookmarks = item.bookmarks.includes(item.position) ? item.bookmarks.filter(i => i !== item.position) : [...item.bookmarks, item.position].sort((a, b) => a - b);
      return { ...item, bookmarks, bookmarkPreviews: Object.fromEntries(bookmarks.map(index => [index, doc.segments[index]])) };
    }));
  }
  async function removeDocument(item: LibraryItem) {
    if (exporting) return;
    try {
      await deleteDocument(item.id);
      try { removeReadingCheckpoint(localStorage, item.id); } catch { /* Removing the library entry still succeeds. */ }
      setDocuments(items => items.filter(d => d.id !== item.id));
      if (item.id === activeId) { player.stop(); stopPreview(); clearSpeechCache(); setOpenText(undefined); setExportResult(undefined); setActiveId(''); setView('library'); }
      notify('Document removed from your library. Your original file is unchanged.');
    } catch (error) { notify((error as Error).message, true); }
  }
  async function previewVoice() {
    if (previewing) { stopPreview(); return; }
    player.stop(); stopPreview(); const token = ++previewRun.current; setPreviewing(true);
    try {
      const audio = await synthesize({ text: `Hello, I'm ${voice.name}. Settle in, take a breath, and let the words come to you. I'll take it from here.`, voice: voiceId, engine: 'local' });
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
    const segments = speechPlan(doc.segments, exportRange === 'remaining' ? doc.position : 0);
    const context = new AudioContext({ sampleRate: 24000 });
    const chunks: Float32Array[] = [];
    let length = 0;
    try {
      for (let index = 0; index < segments.length; index++) {
        if (exportCancelled.current) return;
        const audio = await synthesize({ text: segments[index].text, engine: 'local', voice: voiceId });
        if (exportCancelled.current) return;
        const samples = await decodeSpeech(audio, context);
        chunks.push(samples); length += samples.length;
        if (length > 24000 * 60 * 60 * 2) throw new Error('For long books, export a smaller section at a time. The WAV limit is two hours per export.');
        setExportProgress(Math.round((index + 1) / segments.length * 100));
      }
      if (exportCancelled.current) return;
      let position = 0;
      const merged = new Float32Array(length);
      for (const chunk of chunks) { merged.set(chunk, position); position += chunk.length; }
      const bytes = wavBytes(merged, context.sampleRate);
      const filename = `${doc.title} — ${voice.name}`;
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }));
      setExportResult({ url, filename });
      notify('Audio generated. Choose Save WAV to save it to your computer.');
    } catch (error) { notify((error as Error).message, true); }
    finally { await context.close(); setExporting(false); }
  }

  const filteredVoices = voices.filter(v => voiceFilter === 'All voices' || v.accent === voiceFilter || v.gender.toLowerCase() === voiceFilter.toLowerCase());
  const libraryItems = documents.filter(item => !search || item.title.toLowerCase().includes(search.toLowerCase()));
  const readFrom = useCallback((index: number, character: number) => { stopPreview(); player.playFrom(index, character); }, [stopPreview, player.playFrom]);
  const showOriginalPage = useCallback((page: number) => { setFollowAudio(false); setPdfPage(page); setBrowseRequest({ key: `page-${page}` }); setOriginal(true); }, []);

  return <div className={`app-shell ${libraryOpen && !focusMode ? '' : 'library-hidden'} ${voiceVisible ? '' : 'voice-hidden'} ${focusMode ? 'focus-mode' : ''} ${view === 'reader' && doc ? 'is-reading' : ''} ${dragging ? 'dragging' : ''}`} onDragOver={e => { e.preventDefault(); if (e.dataTransfer.types.includes('Files')) setDragging(true); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }} onDrop={e => { e.preventDefault(); setDragging(false); void importFiles(e.dataTransfer.files); }}>
    <input className="sr-only" ref={input} type="file" accept=".pdf,.docx,.txt,.md" multiple aria-label="Import documents" onChange={e => { if (e.target.files) void importFiles(e.target.files); }} />
    <aside className="sidebar" id="library-sidebar" hidden={!libraryOpen || focusMode}>
      <button className="brand" onClick={() => { setView('reader'); if (!doc && documents[0]) setActiveId(documents[0].id); }}><span className="brand-symbol"><AudioLines size={24} /></span><span>cadence<span className="brand-dot">.</span></span></button>
      <div className="sidebar-caption">A LITTLE MORE LIFE IN EVERY WORD</div>
      <button className="primary import-button" onClick={() => input.current?.click()} disabled={importing || exporting}>{importing ? <LoaderCircle className="spin" size={17} /> : <Plus size={18} />} {importing ? 'Opening document…' : 'Import document'}</button>
      <nav aria-label="Main navigation">
        <button className={view !== 'bookmarks' ? 'nav-item selected' : 'nav-item'} onClick={() => { flushReading(); setView('library'); setSearch(''); }}><Library size={19} /> My library <span>{documents.length}</span></button>
        <button className={view === 'bookmarks' ? 'nav-item selected' : 'nav-item'} onClick={() => { flushReading(); setView('bookmarks'); setSearch(''); }}><Bookmark size={18} /> Bookmarks <span>{documents.reduce((n, d) => n + d.bookmarks.length, 0)}</span></button>
      </nav>
      <div className="section-label recent-label">ON YOUR SHELF <button className="icon-button" aria-label="Paste text" title="Paste text" onClick={() => setModal('paste')}><Plus size={15} /></button></div>
      <div className="recent-documents">{documents.slice(0, 7).map(item => <div className="shelf-row" key={item.id}><button className={`recent-document ${activeId === item.id && view === 'reader' ? 'current' : ''}`} onClick={() => selectDocument(item)}><span className={`file-icon ${item.kind.toLowerCase()}`}><FileText size={17} /></span><span><b>{item.title}</b><small>{item.kind} <i>·</i> {durationLabel(item.wordCount)} listen</small></span></button><button className="icon-button shelf-remove" aria-label={`Remove ${item.title} from shelf`} title="Remove from library" disabled={exporting} onClick={() => void removeDocument(item)}><Trash2 size={14} /></button></div>)}</div>
      <div className="sidebar-bottom"><div className="local-card"><span className="little-star">✦</span><b>A voice. A little company.</b><p>Turn the words you love into<br />something you can listen to.</p><span><LockKeyhole size={12} /> Your library stays on this device</span></div>
        <button className="nav-item" onClick={() => setModal('settings')}><Settings2 size={18} /> Settings</button><button className="nav-item" onClick={() => setModal('help')}><CircleHelp size={18} /> A little help <span className="version">v1.0.12</span></button>
      </div>
    </aside>

    <div className="workspace">
      {importing && <div className="import-status" role="status"><LoaderCircle className="spin" size={15} /><span>{importStatus}</span><button className="text-button" onClick={() => { importAbort.current?.abort(); setImportStatus('Cancelling import…'); }}>Cancel import</button></div>}
      <header className="topbar"><div className="topbar-left"><button className="icon-button library-toggle" aria-label={libraryOpen ? 'Hide library sidebar' : 'Show library sidebar'} aria-expanded={libraryOpen} aria-controls="library-sidebar" title={libraryOpen ? 'Hide library sidebar' : 'Show library sidebar'} onClick={toggleLibrary}>{libraryOpen ? <PanelLeftClose size={19} /> : <PanelLeftOpen size={19} />}</button>{view === 'reader' && doc ? <div className="reader-document-heading"><h1 title={doc.title}>{doc.title}</h1><div className="document-meta"><span className={`type-pill ${doc.kind.toLowerCase()}`}>{doc.kind}</span><span>{totalWords.toLocaleString()} words</span><span className="meta-dot">·</span><span>{durationLabel(totalWords, speed)} listen</span>{doc.kind === 'PDF' && <><span className="meta-dot">·</span><span>{doc.pageCount} pages</span></>}</div></div> : <div className="breadcrumb"><Headphones size={17} /><span>Your listening room</span><ChevronRight size={14} /><b>{view === 'reader' ? 'Reader' : view === 'library' ? 'My library' : 'Bookmarks'}</b></div>}</div><div className="topbar-actions"><span className="privacy-badge"><span /> Private. On your device.</span><button className="panel-toggle" aria-label={voiceVisible ? 'Hide voice panel' : 'Show voice panel'} aria-expanded={voiceVisible} aria-controls="voice-panel" title={`Narrator · ${voice.name}`} onClick={toggleVoicePanel}><AudioLines size={17} /><span>Voice</span></button><button className="icon-button" aria-label="Enter full screen" title="Full screen · F11" disabled={!doc || view !== 'reader'} onClick={() => void toggleFullScreen()}><Maximize2 size={17} /></button>{view === 'reader' && doc && <div className="document-tools"><button className="icon-button" aria-label="Close document" title="Close document · keep on shelf" disabled={exporting} onClick={() => { flushReading(); player.stop(); stopPreview(); clearSpeechCache(); setOpenText(undefined); setActiveId(''); setView('library'); }}><X size={19} /></button><button className="icon-button" aria-label="Remove current document" title="Remove from library · original file stays on disk" disabled={exporting} onClick={() => void removeDocument(activeItem!)}><Trash2 size={17} /></button></div>}</div></header>
      <div className="workspace-body">
        <main className="main-panel">
          {view === 'reader' && opening ? <div className="empty-state"><LoaderCircle className="spin" size={28} /><p>Opening {activeItem?.title || 'document'}…</p></div> : view === 'reader' && doc ? <>

            <div className="reading-toolbar"><div className="view-switch"><button className={!original ? 'active' : ''} onClick={() => switchReaderView(false)}><BookOpen size={15} /> Reading view</button>{doc.kind === 'PDF' && <button className={original ? 'active' : ''} onClick={() => switchReaderView(true)}><FileText size={15} /> Original PDF</button>}</div><div className="reading-actions"><button className="icon-button" aria-label="Search document" title="Search document" onClick={() => { setShowSearch(!showSearch); setSearch(''); }}><Search size={17} /></button><div className="toolbar-divider" /><button className="font-toggle" title="Change typeface" aria-label="Change typeface" onClick={() => setFontTheme(fontTheme === 'serif' ? 'sans' : 'serif')}>Aa</button><button className="icon-button compact" aria-label="Smaller text" disabled={fontSize <= 15} onClick={() => setFontSize(s => Math.max(15, s - 1))}><Minus size={14} /></button><button className="icon-button compact" aria-label="Larger text" disabled={fontSize >= 28} onClick={() => setFontSize(s => Math.min(28, s + 1))}><Plus size={14} /></button><div className="toolbar-divider" /><button className={`icon-button ${bookmarks.includes(doc.position) ? 'is-bookmarked' : ''}`} aria-label={bookmarks.includes(doc.position) ? 'Remove bookmark' : 'Bookmark current passage'} title="Bookmark current passage" onClick={toggleBookmark}><Bookmark size={17} fill={bookmarks.includes(doc.position) ? 'currentColor' : 'none'} /></button></div></div>
            {showSearch && <div className="search-bar"><Search size={16} /><input autoFocus placeholder="Find a word or phrase…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search document text" /><span>{search ? `${doc.segments.filter(s => s.text.toLowerCase().includes(search.toLowerCase())).length} passages` : ''}</span><button className="icon-button" aria-label="Close search" onClick={() => { setShowSearch(false); setSearch(''); }}><X size={16} /></button></div>}
            <div className="reader-navigation-bar">
            <LocationControls locations={locations} current={currentLocation?.key || ''} pdf={doc.kind === 'PDF'} onNavigate={navigateToLocation} open={navigationVisible} onToggle={toggleNavigation} />
            <div className="audio-navigation"><span><Headphones size={13} /> {doc.kind === 'PDF' ? `Audio on page ${doc.segments[doc.position]?.page || 1}` : `Audio at passage ${doc.position + 1}`}</span><button className="text-button" onClick={goToAudio}>Go to audio</button><button className={`follow-audio ${followAudio ? 'enabled' : ''}`} aria-pressed={followAudio} onClick={() => { if (!followAudio) goToAudio(); setFollowAudio(!followAudio); }} title="Keep the current audio in view. Scrolling or changing pages turns following off."><span aria-hidden="true">{followAudio ? <Check size={12} /> : null}</span>Follow audio</button></div>
            </div>
            <div className={`reader-body ${navigationVisible ? 'navigation-open' : ''}`}>
            {navigationVisible && <><button className="navigation-backdrop" aria-label="Dismiss document navigation" onClick={closeNavigation} /><DocumentNavigation key={doc.id} documentId={doc.id} locations={locations} contents={chapters} current={sidebarCurrent} audio={sidebarAudio} pageCurrent={currentLocation?.key || ''} pageAudio={audioLocation?.key} pdf={doc.kind === 'PDF'} source={doc.navigationSource} loading={findingTopics} onRebuild={() => setNavigationRefresh(doc.id)} onNavigate={navigateToLocation} onClose={closeNavigation} /></>}
            <div className="reader-scroll" ref={readerScroll} onWheel={() => setFollowAudio(false)} onTouchMove={() => setFollowAudio(false)} onPointerDown={event => { if (event.target === event.currentTarget) setFollowAudio(false); }} onKeyDownCapture={event => { if (['PageDown', 'PageUp', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' '].includes(event.key)) setFollowAudio(false); }}>
              {original && doc.kind === 'PDF' ? <><div className="pdf-pagination"><button className="icon-button" disabled={pdfPage <= 1} aria-label="Previous PDF page" onClick={() => navigateToLocation(`page-${pdfPage - 1}`)}><ChevronLeft size={18} /></button><span>Page {pdfPage} of {doc.pageCount}</span><button className="icon-button" disabled={pdfPage >= doc.pageCount} aria-label="Next PDF page" onClick={() => navigateToLocation(`page-${pdfPage + 1}`)}><ChevronRight size={18} /></button><button className="text-button" onClick={() => { const index = doc.segments.findIndex(s => s.page === pdfPage); if (index >= 0) player.playFrom(index); else notify('This page has no selectable text.'); }}>Listen from this page</button></div><PdfPage documentId={doc.id} pageNumber={pdfPage} jumpTarget={browseRequest} segments={doc.segments} onWord={(index, character) => { if (!exporting && voiceId) readFrom(index, character); }} /></> : <article className={`reading-paper ${fontTheme}`} style={{ '--reader-size': `${fontSize}px` } as React.CSSProperties}>
                <div className="paper-topline"><span>THE READING ROOM</span><span>{doc.kind === 'PDF' ? 'ORIGINAL PDF PAGES' : 'DOCUMENT SECTIONS'}</span></div>
                {locations.map(location => <ReadingSection key={`${doc.id}-${location.key}`} location={location} segments={doc.segments} pdf={doc.kind === 'PDF'} count={locations.length} position={doc.position >= location.start && doc.position < location.end ? doc.position : -1} bookmarks={bookmarks} search={search} disabled={exporting || !voiceId} force={location.key === browseRequest?.key || location.key === audioLocation?.key} fontSize={fontSize} fontTheme={fontTheme} activeRef={activeParagraph} onRead={readFrom} onOriginal={showOriginalPage} />)}
                {search && !doc.segments.some(s => s.text.toLowerCase().includes(search.toLowerCase())) && <p className="empty-message">No passages found. Try a different phrase.</p>}
                <div className="paper-end">✦</div>
              </article>}
              <p className="reading-hint"><Headphones size={13} /> Click any word to listen from there. Drag to select text.</p>
            </div>
            </div>
          </> : view === 'bookmarks' ? <>
            <div className="document-heading"><div><span className="eyebrow">WORDS TO COME BACK TO</span><h1>Your bookmarks</h1><p className="subtext">Good ideas deserve a second listen.</p></div></div>
            <div className="library-scroll">{documents.flatMap(item => item.bookmarks.map(index => <button key={`${item.id}-${index}`} className="bookmark-card" onClick={() => { selectDocument(item); updateBookmarkedPosition(item.id, index); }}><Bookmark size={20} /><span><b>{item.title}</b><p>{item.bookmarkPreviews[index]?.text}</p><small>Passage {index + 1} · Page {item.bookmarkPreviews[index]?.page}</small></span><ArrowRight size={18} /></button>))}{!documents.some(item => item.bookmarks.length) && <div className="empty-state"><Bookmark size={36} /><h2>Keep a little of what you love.</h2><p>Use the bookmark button while reading to save a passage here.</p><button className="secondary" onClick={() => setView(doc ? 'reader' : 'library')}>Back to reading</button></div>}</div>
          </> : <>
            <div className="document-heading"><div><span className="eyebrow">A SHELF FULL OF POSSIBILITIES</span><h1>Your words. Your rhythm.</h1><p className="subtext">Everything you want to read, ready to be heard.</p></div></div>
            <div className="library-scroll"><button className="upload-area" onClick={() => input.current?.click()} disabled={importing || exporting}><span className="upload-circle">{importing ? <LoaderCircle className="spin" /> : <Upload />}</span><b>{importing ? 'Getting your words ready…' : 'Drop a document. Find your next listen.'}</b><p>PDF, Word, text or Markdown <span>·</span> Up to 50 MB</p><span className="secondary">Browse files <ArrowRight size={15} /></span></button><div className="library-list-heading"><h2>On your shelf <span>{documents.length}</span></h2><button className="text-button" onClick={() => setModal('paste')}><Plus size={15} /> Paste text instead</button></div><div className="library-search"><Search size={16} /><input aria-label="Search library" placeholder="Find a document…" value={search} onChange={e => setSearch(e.target.value)} /></div>
              <div className="document-grid">{libraryItems.map(item => <div className="document-card" key={item.id}><button className="document-card-main" onClick={() => selectDocument(item)}><span className={`book-cover ${item.kind.toLowerCase()}`}><span>cadence library</span><BookOpen size={29} strokeWidth={1} /><b>{item.title}</b><small>{item.kind}</small></span><h3>{item.title}</h3><p>{item.kind} <span>·</span> {durationLabel(item.wordCount)} listen</p><span className="mini-progress"><i style={{ width: `${item.position / Math.max(1, item.segmentCount - 1) * 100}%` }} /></span></button><button className="icon-button remove-document" aria-label={`Remove ${item.title}`} title="Remove from library" disabled={exporting} onClick={() => void removeDocument(item)}><Trash2 size={15} /></button></div>)}</div>{!libraryItems.length && <p className="empty-message">{search ? 'No documents match your search.' : 'Your listening library starts here.'}</p>}
            </div>
          </>}
        </main>

        <aside className="voice-panel" id="voice-panel" aria-label="Voice selection" hidden={!voiceVisible}><div className="voice-panel-title"><h2>Your narrator</h2><button className="icon-button" aria-label="Close voice panel" title="Hide voice panel" onClick={toggleVoicePanel}><PanelRightClose size={17} /></button></div><p className="voice-intro">A voice that feels like good company.</p>
          <div className="selected-voice"><div className="selected-voice-top"><VoiceAvatar voice={voice} large /><div><h3>{voice.name}</h3><p>{voice.accent} {voice.gender && '·'} {voice.gender}</p></div><span className="voice-selected-check"><Check size={14} /></span></div><p>{voice.description}</p><button className="preview-button" onClick={() => void previewVoice()} disabled={exporting || !voiceId}>{previewing ? <LoaderCircle size={14} className="spin" /> : <Play size={13} fill="currentColor" />}{previewing ? 'Stop preview' : 'Listen to a preview'}<Waveform small active={previewing} /></button></div>
          <div className="voices-heading"><span className="section-label">FIND YOUR VOICE</span><select aria-label="Filter voices" value={voiceFilter} onChange={e => setVoiceFilter(e.target.value)}><option>All voices</option><option>American</option><option>British</option><option>Female</option><option>Male</option></select></div>
          <div className="voice-list">{filteredVoices.map(item => <button key={item.id} className={`voice-option ${voiceId === item.id ? 'selected' : ''}`} onClick={() => setLocalVoice(item.id)} disabled={exporting}><VoiceAvatar voice={item} /><span><b>{item.name}</b><small>{item.accent} <i>·</i> {item.gender}</small></span>{voiceId === item.id ? <Check size={16} className="check" /> : <span className="voice-radio" />}</button>)}{!filteredVoices.length && <p className="empty-message">No voices match this filter.</p>}</div>
          <div className="voice-footer"><ShieldCheck size={16} /><span>Natural voices. No subscriptions.<small>Your words stay on your computer.</small></span></div>
        </aside>
      </div>

      {focusMode && doc && <FocusControls playing={playing} busy={busy} disabled={exporting || !voiceId} page={currentLocation?.number || 1} count={locations.length} pdf={doc.kind === 'PDF'} original={original} speed={speed} voiceOpen={voiceVisible} navigationOpen={navigationVisible} bookmarked={bookmarks.includes(doc.position)} onExit={() => void toggleFullScreen()} onToggle={player.toggle} onSkip={player.seekSeconds} onPage={number => { const location = locations[number - 1]; if (location) navigateToLocation(location.key); }} onNavigate={toggleNavigation} onVoice={toggleVoicePanel} onSpeed={setSpeed} onOriginal={() => switchReaderView(!original)} onBookmark={toggleBookmark} onAudio={goToAudio} />}
      <div className={`player-dock ${playerExpanded ? 'expanded' : ''}`} onFocusCapture={event => setPlayerFocused((event.target as HTMLElement).matches(':focus-visible'))} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPlayerFocused(false); }}>
      <button className="player-reveal" aria-label="Show playback controls" aria-controls="playback-controls" aria-expanded={playerExpanded}><ChevronUp size={13} /><span>Playback</span></button>
      <footer id="playback-controls" aria-label="Playback controls" aria-hidden={!playerExpanded} inert={!playerExpanded} className="player" data-buffered-seconds={Math.floor(player.bufferedSeconds)}><div className="player-top"><div className="player-track"><div className="now-playing-art"><Waveform active={playing} /></div><div className="now-playing"><span>{busy ? (modelState === 'loading' ? `Preparing voice model${modelProgress !== undefined ? ` · ${Math.round(modelProgress)}%` : '…'}` : 'Preparing first phrase…') : playing ? 'NOW PLAYING' : player.state === 'paused' ? 'TAKE YOUR TIME' : 'READY WHEN YOU ARE'} {playing && <span className="playing-dot" />}</span><b>{doc?.title || 'Your next good listen'}</b><small>{voice.name} <i>·</i> Local neural</small></div></div><div className="playback-controls"><button className="icon-button" aria-label="Previous passage" title="Previous passage" disabled={!doc || exporting} onClick={() => player.jump((doc?.position || 0) - 1)}><SkipBack size={18} /></button><button className="jump-button" aria-label="Back 15 seconds" title="Back 15 seconds" disabled={!doc || exporting} onClick={() => player.seekSeconds(-15)}><span>↶</span><small>15</small></button><button className="play-button" aria-label={busy ? 'Cancel loading' : playing ? 'Pause narration' : 'Play narration'} disabled={!doc || exporting || !voiceId} onClick={player.toggle}>{busy ? <LoaderCircle className="spin" size={24} /> : playing ? <Pause size={23} fill="currentColor" /> : <Play size={23} fill="currentColor" />}</button><button className="jump-button" aria-label="Forward 15 seconds" title="Forward 15 seconds" disabled={!doc || exporting} onClick={() => player.seekSeconds(15)}><span>↷</span><small>15</small></button><button className="icon-button" aria-label="Next passage" title="Next passage" disabled={!doc || exporting} onClick={() => player.jump((doc?.position || 0) + 1)}><SkipForward size={18} /></button><label className="player-speed" title="Narration speed"><input type="range" min="0.65" max="1.75" step="0.05" value={speed} aria-label="Narration speed" onChange={e => setSpeed(Number(e.target.value))} /><span>{speed.toFixed(2).replace(/0$/, '')}×</span></label></div><div className="player-extras"><label className="sleep-control" title="Sleep timer"><Timer size={17} /><select aria-label="Sleep timer" value={sleep} onChange={e => setSleep(Number(e.target.value))}><option value={0}>Sleep timer</option><option value={5}>5 minutes</option><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={60}>60 minutes</option></select></label><button className="export-button" onClick={() => { setExportResult(undefined); setModal('export'); }} disabled={!doc || exporting}><ArrowDownToLine size={16} /> Export audio</button></div></div><div className="player-timeline"><span>{clockTime(elapsed / speed)}</span><input type="range" min={0} max={100} step={.1} value={progress} aria-label="Reading progress" disabled={!doc || exporting} style={{ '--progress': `${progress}%` } as React.CSSProperties} onChange={e => { const target = Number(e.target.value) / 100 * totalWords; let sum = 0; let index = 0; while (doc && index < doc.segments.length - 1 && sum + doc.segments[index].text.split(/\s+/).length < target) { sum += doc.segments[index].text.split(/\s+/).length; index++; } player.jump(index); }} /><span>~{clockTime(estimatedSeconds / speed)}</span><span className="timeline-label">{Math.round(progress)}% through <i>·</i> {playing || player.state === 'paused' ? `${Math.floor(player.bufferedSeconds)}s ready` : 'Your place is saved'}</span></div></footer>
      </div>
    </div>

    {modal === 'paste' && <Modal title="Give your words a voice." subtitle="A passage, an article, a thought. Make it a listen." onClose={() => setModal(null)}><label className="field-label">Document title<input placeholder="A name for your document" value={noteTitle} onChange={e => setNoteTitle(e.target.value)} /></label><label className="field-label">Your text<textarea rows={9} placeholder="Paste or write something here…" value={noteText} onChange={e => setNoteText(e.target.value)} /></label><div className="modal-footer"><span>{noteText.trim() ? noteText.trim().split(/\s+/).length : 0} words</span><button className="primary" onClick={addNote} disabled={!noteText.trim()}>Add to my library <ArrowRight size={16} /></button></div></Modal>}
    {modal === 'settings' && <Modal title="Make yourself at home." subtitle="Your voices, your way of listening." onClose={() => setModal(null)}><div className="settings-section"><h3><AudioLines size={18} /> Local neural voices <span className="free-badge">Always free</span></h3><p>Eight natural English voices, powered by Kokoro. Speech is generated privately on this computer. The model downloads once (about 326 MB), if it isn’t already bundled.</p><button className="secondary" onClick={() => void prepareModel()} disabled={modelState === 'loading'}>{modelState === 'ready' ? <CheckCheck size={17} /> : modelState === 'loading' ? <LoaderCircle className="spin" size={17} /> : <ArrowDownToLine size={17} />}{modelState === 'ready' ? 'Local voices are ready' : modelState === 'loading' ? `Preparing voices${modelProgress !== undefined ? ` · ${Math.round(modelProgress)}%` : '…'}` : 'Prepare local voices'}</button></div><div className="settings-section"><h3><Headphones size={18} /> Smooth playback</h3><p>Quick start plays the first phrase as soon as it is ready. Upcoming phrases prepare while you listen, and local voices warm up when you open the app.</p><label className="field-label">When to start speaking<select aria-label="Playback buffer" value={startupSeconds} onChange={e => setStartupSeconds(Number(e.target.value))}><option value={0}>Quick start · first phrase ready</option><option value={3}>Small reserve · 3 seconds of audio</option><option value={8}>Extra reserve · 8 seconds of audio</option></select></label><p className="field-hint">Quick start is the default. A small reserve can help on slower computers. Up to 12 upcoming phrases prepare in the background.</p></div></Modal>}
    {modal === 'export' && <Modal title="Take your listen with you." subtitle="Save a WAV file to play in any audio app." onClose={() => { if (exporting) { exportCancelled.current = true; } setModal(null); }}><div className="export-summary"><VoiceAvatar voice={voice} large /><div><b>{doc?.title}</b><span>{voice.name} · Local neural voice · WAV</span></div></div><label className="field-label">What would you like to export?<select value={exportRange} onChange={e => setExportRange(e.target.value as 'all' | 'remaining')} disabled={exporting}><option value="all">The entire document</option><option value="remaining">From my current passage to the end</option></select></label><p className="field-hint">Export uses the voice’s natural pace (1×). Longer documents take time to generate.</p>{exporting && <div className="export-progress"><progress max={100} value={exportProgress} /><span>Creating your audio · {exportProgress}%</span></div>}<div className="modal-footer"><button className="text-button" onClick={() => { exportCancelled.current = true; setModal(null); }}>{exporting ? 'Cancel export' : 'Close'}</button>{exportResult ? <button className="primary" onClick={async () => { try { const bytes = new Uint8Array(await (await fetch(exportResult.url)).arrayBuffer()); if (await window.cadence?.saveAudio(bytes, exportResult.filename)) notify('Your audio has been saved.'); } catch (error) { notify((error as Error).message, true); } }}><ArrowDownToLine size={16} /> Save WAV</button> : <button className="primary" disabled={exporting || !voiceId} onClick={() => void exportAudio()}>{exporting ? <LoaderCircle size={16} className="spin" /> : <AudioLines size={16} />}{exporting ? 'Creating audio…' : 'Create audio file'}</button>}</div></Modal>}
    {modal === 'help' && <Modal title="A little help." subtitle="Less setup. More listening." onClose={() => setModal(null)}><div className="help-item"><span>01</span><div><h3>Bring something to read</h3><p>Import a PDF, DOCX, TXT or Markdown file, or paste text. PDFs need selectable text; scanned pages need OCR first.</p></div></div><div className="help-item"><span>02</span><div><h3>Find your narrator</h3><p>Choose a local neural voice and try a preview. On first use, the free voice model may need to download. Local narration currently supports English.</p></div></div><div className="help-item"><span>03</span><div><h3>Make yourself comfortable</h3><p>Press play, or click any word to start reading from that exact word. Your library, bookmarks and reading position are saved automatically on this device.</p></div></div><div className="keyboard-hints"><span><kbd>Space</kbd> Play / pause</span><span><kbd>←</kbd> <kbd>→</kbd> Skip 15 seconds</span></div><p className="field-hint">Reading times and progress are estimates. Highlighting follows each passage. The original PDF tab preserves the page layout.</p></Modal>}
    {toast && <div className={`toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <CircleHelp size={18} /> : <Check size={18} />}<span>{toast.message}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast(undefined)}><X size={16} /></button></div>}
    {dragging && <div className="drop-overlay"><Upload size={40} /><h2>Make it your next listen.</h2><p>Drop your documents here</p></div>}
  </div>;

  function updateBookmarkedPosition(id: string, position: number) { setDocuments(items => items.map(item => item.id === id ? { ...item, position } : item)); }
}
