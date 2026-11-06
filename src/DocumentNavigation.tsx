import { memo, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Headphones, List, LocateFixed, RefreshCw, Search, X } from 'lucide-react';
import { locationPath, type DocumentLocation } from './locations';

interface Props {
  locations: DocumentLocation[];
  current: string;
  audio?: string;
  pdf: boolean;
  onNavigate(key: string): void;
}

export const LocationControls = memo(function LocationControls({ locations, current, pdf, onNavigate, open, onToggle }: Props & { open: boolean; onToggle(): void }) {
  const index = Math.max(0, locations.findIndex(location => location.key === current));
  const [value, setValue] = useState(String(index + 1));
  const editing = useRef(false);
  useEffect(() => { if (!editing.current) setValue(String(index + 1)); }, [index, locations]);
  return <div className="location-controls">
    <button className={`navigation-toggle ${open ? 'selected' : ''}`} aria-label="Document navigation" aria-expanded={open} aria-controls="document-navigation" onClick={onToggle}><List size={15} /><span>Navigate</span></button>
    <div className="location-jump">
      <button className="icon-button" aria-label={pdf ? 'Previous document page' : 'Previous section'} disabled={index === 0} onClick={() => onNavigate(locations[index - 1].key)}><ChevronLeft size={16} /></button>
      <form onSubmit={event => { event.preventDefault(); const number = Number(value); if (Number.isInteger(number) && number >= 1 && number <= locations.length) { editing.current = false; onNavigate(locations[number - 1].key); } }}>
        <label>{pdf ? 'PDF page' : 'Section'} <input aria-label={pdf ? 'Go to original page' : 'Go to section'} type="number" min={1} max={locations.length} step={1} required value={value} onChange={event => { editing.current = true; setValue(event.target.value); }} onBlur={() => { editing.current = false; setValue(String(index + 1)); }} title="Enter a number and press Enter" /></label><span>of {locations.length}</span>
      </form>
      <button className="icon-button" aria-label={pdf ? 'Next document page' : 'Next section'} disabled={index >= locations.length - 1} onClick={() => onNavigate(locations[index + 1].key)}><ChevronRight size={16} /></button>
    </div>
    <span className="viewing-location" data-location={current}>{pdf ? locations[index]?.title : `Viewing section ${index + 1}`}</span>
  </div>;
});

interface NavigationProps extends Props {
  contents: DocumentLocation[]; pageCurrent: string; pageAudio?: string;
  documentId: string; loading?: boolean; source?: string;
  onClose(): void; onRebuild(): void;
}

export default memo(function DocumentNavigation({ locations, contents, current, audio, pageCurrent, pageAudio, pdf, documentId, onNavigate, onClose, onRebuild, source, loading = false }: NavigationProps) {
  const [filter, setFilter] = useState('');
  const [mode, setMode] = useState<'contents' | 'pages'>(contents.length || loading ? 'contents' : 'pages');
  const chosenMode = useRef(false);
  const [pageGroup, setPageGroup] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(`cadence-contents-v3:${documentId}`) || '[]')); } catch { return new Set(); }
  });
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!chosenMode.current) setMode(contents.length || loading ? 'contents' : 'pages'); }, [contents.length, loading]);
  useEffect(() => { localStorage.setItem(`cadence-contents-v3:${documentId}`, JSON.stringify([...expanded])); }, [expanded, documentId]);
  const path = locationPath(contents, current), audioPath = locationPath(contents, audio || '');
  const activeKeys = new Set(path.map(entry => entry.key)), audioKeys = new Set(audioPath.map(entry => entry.key));
  const query = filter.trim().toLocaleLowerCase();
  function filtered(entries: DocumentLocation[]): DocumentLocation[] {
    if (!query) return entries;
    return entries.flatMap(entry => {
      const own = `${entry.title} ${entry.preview}`.toLocaleLowerCase().includes(query);
      const children = own ? entry.children : filtered(entry.children || []);
      return own || children?.length ? [{ ...entry, children }] : [];
    });
  }
  const shown = filtered(contents);
  const pages = query ? locations.filter(location => `${location.number} ${location.title} ${location.preview}`.toLocaleLowerCase().includes(query)) : locations;
  const group = Math.min(pageGroup, Math.max(0, Math.ceil(pages.length / 40) - 1));
  const visiblePages = pages.slice(group * 40, (group + 1) * 40);
  const partCount = contents.filter(entry => /^(part|book|volume)\s+/i.test(entry.title)).length;
  const chapterCount = contents.filter(entry => /^chapter\s+/i.test(entry.title)).length;
  const mainCount = contents.filter(entry => entry.title !== 'Opening pages').length;
  const summary = partCount ? `${partCount} ${partCount === 1 ? 'part' : 'parts'}` : chapterCount ? `${chapterCount} ${chapterCount === 1 ? 'chapter' : 'chapters'}` : contents.length ? `${mainCount} main topics` : pdf ? `${locations.length} PDF pages` : `${locations.length} sections`;
  function toggle(key: string) { setExpanded(previous => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next; }); }
  function locate() {
    setFilter('');
    if (mode === 'contents') setExpanded(previous => new Set([...previous, ...path.slice(0, -1).map(entry => entry.key)]));
    else setPageGroup(Math.floor(Math.max(0, locations.findIndex(location => location.key === pageCurrent)) / 40));
    requestAnimationFrame(() => {
      const element = list.current?.querySelector<HTMLElement>(`[data-navigation-key="${mode === 'contents' ? current : pageCurrent}"]`);
      if (element && list.current) list.current.scrollTop += element.getBoundingClientRect().top - list.current.getBoundingClientRect().top - 20;
    });
  }
  function renderTree(entries: DocumentLocation[], depth = 0): React.ReactNode {
    return <ul className="navigation-tree">{entries.map(entry => {
      const children = entry.children || [], open = query ? children.length > 0 : expanded.has(entry.key);
      const selected = current === entry.key || (!open && activeKeys.has(entry.key));
      return <li key={entry.key}>
        <div className={`navigation-row ${selected ? 'browsing' : ''} ${activeKeys.has(entry.key) ? 'contains-current' : ''}`} style={{ '--navigation-depth': Math.min(4, depth) } as React.CSSProperties}>
          {children.length ? <button className="navigation-disclosure" aria-label={`${open ? 'Collapse' : 'Expand'} ${entry.title}`} aria-expanded={open} aria-controls={`branch-${entry.key}`} onClick={() => toggle(entry.key)}><ChevronDown size={14} /></button> : <span className="navigation-leaf" />}
          <button className="navigation-topic" data-navigation-key={entry.key} aria-label={`Browse topic ${entry.number}: ${entry.title}`} aria-current={selected ? 'location' : undefined} title={entry.title} onClick={() => onNavigate(entry.key)}>
            <b>{entry.title}</b><small>{children.length ? `${children.length} ${children.length === 1 ? 'section' : 'sections'} · ` : ''}{entry.preview}</small>
          </button>
          {audioKeys.has(entry.key) && (!open || audio === entry.key) && <Headphones className="navigation-audio" size={13} aria-label="Audio position" />}
        </div>
        {children.length > 0 && open && <div id={`branch-${entry.key}`}>{renderTree(children, depth + 1)}</div>}
      </li>;
    })}</ul>;
  }
  return <aside className="document-navigation" id="document-navigation" aria-label="Document navigation sidebar">
    <div className="navigation-heading"><div><h2>Contents</h2><p>{summary}{loading && ' · Updating…'}</p></div><button className="icon-button" aria-label="Close document navigation" onClick={onClose}><X size={15} /></button></div>
    <div className="navigation-modes" role="group" aria-label="Navigation view"><button className={mode === 'contents' ? 'selected' : ''} aria-pressed={mode === 'contents'} onClick={() => { chosenMode.current = true; setMode('contents'); setFilter(''); }}>Contents</button><button className={mode === 'pages' ? 'selected' : ''} aria-pressed={mode === 'pages'} onClick={() => { chosenMode.current = true; setMode('pages'); setFilter(''); }}>{pdf ? 'Pages' : 'Sections'}</button></div>
    <label className="navigation-search"><Search size={13} /><input aria-label="Filter document navigation" placeholder={mode === 'contents' ? 'Find a chapter or topic…' : 'Find a page or phrase…'} value={filter} onChange={event => { setFilter(event.target.value); setPageGroup(0); }} /></label>
    <div className="navigation-current"><span>{mode === 'contents' && path.length ? path.map(entry => entry.title).join(' › ') : locations.find(entry => entry.key === pageCurrent)?.title || 'Beginning of document'}</span><button className="icon-button" aria-label="Locate current chapter or page" title="Show my current location in this list" onClick={locate}><LocateFixed size={15} /></button></div>
    <div className="navigation-list" ref={list}>
      {mode === 'contents' ? <>{renderTree(shown)}{!contents.length && <p className="navigation-empty">{loading ? 'Building the document contents… You can browse pages while this runs.' : 'No reliable chapter structure was found. Use the page list to navigate this document.'}</p>}{contents.length > 0 && !shown.length && <p className="navigation-empty">No matching chapters or topics.</p>}</> : <>{visiblePages.map(location => <button key={location.key} data-navigation-key={location.key} className={`navigation-entry ${pageCurrent === location.key ? 'browsing' : ''}`} aria-label={`Browse ${pdf ? 'page' : 'section'} ${location.number}`} aria-current={pageCurrent === location.key ? 'location' : undefined} onClick={() => onNavigate(location.key)}>
        <span className="navigation-number">{location.number}</span><span className="navigation-entry-text"><b>{location.title}</b><small>{location.preview}</small></span>
        {pageAudio === location.key && <Headphones className="navigation-audio" size={13} aria-label="Audio position" />}
      </button>)}{!pages.length && <p className="navigation-empty">No matching pages or sections.</p>}</>}
    </div>
    {mode === 'pages' && pages.length > 40 && <div className="navigation-page-groups"><button className="icon-button" aria-label="Previous page group" disabled={group === 0} onClick={() => setPageGroup(group - 1)}><ChevronLeft size={14} /></button><span>{group * 40 + 1}–{Math.min((group + 1) * 40, pages.length)} of {pages.length}</span><button className="icon-button" aria-label="Next page group" disabled={(group + 1) * 40 >= pages.length} onClick={() => setPageGroup(group + 1)}><ChevronRight size={14} /></button></div>}
    <div className="navigation-source"><span>{source === 'outline' ? 'Book contents' : source === 'contents' ? 'From the contents page' : source === 'headings' ? 'Detected headings' : 'Page navigation'}</span><button className="icon-button" aria-label="Rebuild contents" title="Refresh the document contents" disabled={loading} onClick={onRebuild}><RefreshCw size={12} /></button></div>
    <div className="navigation-legend"><span className="browsing-swatch" /> Browsing <Headphones size={12} /> Audio</div>
  </aside>;
});
