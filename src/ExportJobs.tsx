import { useState } from 'react';
import { ArrowDownToLine, ArrowLeft, FolderOpen, LoaderCircle, Pause, Play, RefreshCw, Search } from 'lucide-react';
import { exportActive, exportError, useExportJobs } from './useExportJobs';
import type { ExportJob } from './types';

const duration = (seconds: number) => `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m ${Math.round(seconds % 60)}s`;
const status = (job: ExportJob) => ({ paused: 'Paused', loading: 'Preparing', running: 'Converting', encoding: 'Finishing', complete: 'Completed', error: 'Needs attention' })[job.status];
export default function ExportJobs({ onBack, onCreate, canCreate }: { onBack(): void; onCreate(): void; canCreate: boolean }) {
  const { jobs, loading, error: loadError, refresh } = useExportJobs();
  const [filter, setFilter] = useState('All'), [search, setSearch] = useState(''), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const running = jobs.some(exportActive), completed = jobs.filter(job => job.status === 'complete').length;
  const shown = jobs.filter(job => (filter === 'All' || (filter === 'Completed' ? job.status === 'complete' : job.status !== 'complete')) && `${job.title} ${job.voiceName}`.toLowerCase().includes(search.toLowerCase().trim()));
  const perform = async (id: string, action: () => Promise<unknown>) => {
    setBusy(id); setError('');
    try { await action(); await refresh(); } catch (reason) { setError(exportError(reason)); }
    finally { setBusy(''); }
  };
  return <section className="export-manager" aria-label="Audio export manager">
    <div className="document-heading"><div><span className="eyebrow">YOUR AUDIOBOOKS</span><h1>Audio exports</h1><p className="subtext">Ongoing conversions and completed audiobooks, in one place.</p></div><button className="secondary collection-back" onClick={onBack}><ArrowLeft size={16} />{canCreate ? 'Back to reading' : 'Back to library'}</button></div>
    <div className="export-manager-scroll">
      <div className="export-manager-actions"><p>{jobs.length - completed} unfinished · {completed} completed</p><button className="primary" onClick={onCreate} disabled={!canCreate}><ArrowDownToLine size={16} />New export</button></div>
      {!canCreate && <p className="field-hint">Open a document from your library to start a new export. Saved jobs can resume without reopening their book.</p>}
      <p className="export-preservation"><Pause size={16} />M4B jobs pause when Cadence closes. Resume from the last saved phrase when you return. Completed exports stay in your history.</p>
      <div className="export-manager-tools"><div className="export-filters" role="group" aria-label="Filter audio exports">{['All', 'Unfinished', 'Completed'].map(name => <button key={name} aria-pressed={filter === name} onClick={() => setFilter(name)}>{name} <span>{name === 'All' ? jobs.length : name === 'Completed' ? completed : jobs.length - completed}</span></button>)}</div><label className="export-search"><Search size={16} /><input aria-label="Search audio exports" placeholder="Find a title or voice…" value={search} onChange={event => setSearch(event.target.value)} /></label><button className="icon-button" aria-label="Refresh audio exports" title="Refresh exports" onClick={() => void refresh()}><RefreshCw size={17} /></button></div>
      {(error || loadError) && <p className="export-error" role="alert">{error || loadError}</p>}
      {loading ? <div className="empty-state"><LoaderCircle size={24} className="spin" /><p>Loading saved exports…</p></div> : !shown.length ? <div className="empty-state"><ArrowDownToLine size={30} /><h2>{jobs.length ? 'No matching exports' : 'Your audiobooks will stay here'}</h2><p>{jobs.length ? 'Try another title, voice or filter.' : 'Create a chaptered M4B from a document. You can pause it, close the app and return later.'}</p></div> : <div className="export-jobs" aria-label="Audio export jobs">{shown.map(job => <article key={job.id} data-export-id={job.id} data-export-status={job.status}>
        <div className="export-job-heading"><h2>{job.title}</h2><span className={`export-status ${job.status}`}>{status(job)}</span></div>
        <div className="export-job-meta"><span>{job.voiceName} · {job.engine === 'kokoro-cuda' ? 'GPU Kokoro' : 'CPU Kokoro'}</span><time dateTime={new Date(job.created).toISOString()}>Created {new Date(job.created).toLocaleString()}</time></div>
        <div className="export-job-progress"><progress aria-label={`${job.title} export progress`} max={100} value={job.progress} /><b>{Math.floor(job.progress)}%</b></div>
        <p role="status">{job.message}</p><small>{duration(job.audioSeconds)} {job.status === 'complete' ? 'of audio' : 'saved'} · {job.chapterCount} chapters</small>
        <div className="export-job-bottom"><details className="export-destination"><summary>{job.status === 'complete' ? 'Saved file' : 'Destination'}</summary><p className="export-path">{job.output}</p></details>{job.status === 'complete' ? <button className="secondary" disabled={!!busy} onClick={() => void perform(job.id, () => window.cadence!.revealExport(job.id))}><FolderOpen size={15} />Show audiobook in folder</button> : exportActive(job) ? <button className="secondary" disabled={!!busy} onClick={() => void perform(job.id, () => window.cadence!.controlExport(job.id, 'pause'))}>{busy === job.id ? <LoaderCircle size={15} className="spin" /> : <Pause size={15} />}Pause export</button> : <button className="secondary" disabled={!!busy || running} onClick={() => void perform(job.id, () => window.cadence!.controlExport(job.id, 'resume'))}>{busy === job.id ? <LoaderCircle size={15} className="spin" /> : <Play size={15} />}{job.status === 'error' ? 'Retry export' : 'Resume export'}</button>}</div>
      </article>)}</div>}
    </div>
  </section>;
}
