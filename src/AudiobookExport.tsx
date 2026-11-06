import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, LoaderCircle, Play } from 'lucide-react';
import { availableVoices, findVoice } from './voices';
import { exportActive, exportError, useExportJobs } from './useExportJobs';
import type { ExportEngine, ExportRequest, ExportRuntime, ExportSample, ReaderDocument } from './types';

interface Sample extends Omit<ExportSample, 'bytes'> { url: string; name: string }
export default function AudiobookExport({ document: doc, voiceId, wav, wavBusy, onClose, onManage }: { document?: ReaderDocument; voiceId: string; wav: React.ReactNode; wavBusy: boolean; onClose(): void; onManage(): void }) {
  const [format, setFormat] = useState('m4b'), [runtime, setRuntime] = useState<ExportRuntime>();
  const [engine, setEngine] = useState<ExportEngine>('kokoro-cuda'), [voice, setVoice] = useState(voiceId);
  const [range, setRange] = useState('all'), [busy, setBusy] = useState(''), [error, setError] = useState(''), [samples, setSamples] = useState<Sample[]>([]);
  const { jobs, loading: jobsLoading, error: jobsError } = useExportJobs();
  const urls = useRef<string[]>([]), comparing = useRef(false), cancelled = useRef(false), mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    void window.cadence?.exportRuntime().then(result => { setRuntime(result); if (!result.kokoroGpu) setEngine('kokoro-cpu'); }).catch(reason => setError(exportError(reason)));
    return () => { mounted.current = false; urls.current.forEach(url => URL.revokeObjectURL(url)); if (comparing.current) void window.cadence?.controlExport('sample', 'pause').catch(() => {}); };
  }, []);
  const words = useMemo(() => doc?.segments.slice(range === 'all' ? 0 : doc.position).reduce((sum, segment) => sum + segment.text.split(/\s+/).length, 0) || 0, [doc?.segments, doc?.position, range]);
  const workingGb = words / 150 * 60 * 24000 * 2 * 1.3 / 1000000000 + .27;
  const running = jobsLoading || jobs.some(exportActive);
  const request = (): ExportRequest => {
    if (!doc) throw new Error('Open a document to start a new export.');
    const { id, title, kind, segments, pageCount, topics, pageLabels } = doc;
    return { document: { id, title, kind, segments, pageCount, topics, pageLabels }, from: range === 'all' ? 0 : doc.position, engine, voice, voiceName: findVoice(voice)?.name || voice };
  };
  const perform = async (action: () => Promise<unknown>, label: string) => {
    setError(''); setBusy(label);
    try { await action(); } catch (reason) { if (mounted.current && !cancelled.current) setError(exportError(reason)); }
    finally { if (mounted.current) setBusy(''); }
  };
  const compare = () => perform(async () => {
    cancelled.current = false; comparing.current = true;
    try {
      const input = request(), result = await window.cadence!.exportSample(input);
      if (!mounted.current || cancelled.current) return;
      const url = URL.createObjectURL(new Blob([new Uint8Array(result.bytes)], { type: 'audio/wav' })); urls.current.push(url);
      setSamples(previous => [...previous.slice(-2), { ...result, url, name: `${engine === 'kokoro-cuda' ? 'GPU Kokoro' : 'CPU Kokoro'} · ${input.voiceName}` }]);
      if (urls.current.length > 3) URL.revokeObjectURL(urls.current.shift()!);
    } finally { comparing.current = false; }
  }, 'sample');
  return <div className="audiobook-export">
    <label className="field-label">Audio format<select aria-label="Audio format" value={format} disabled={wavBusy || !!busy} onChange={event => setFormat(event.target.value)}><option value="m4b">M4B audiobook · chapters and resume</option><option value="wav">WAV · uncompressed · up to 2 hours</option></select></label>
    {format === 'wav' ? wav : <>
      {doc ? <>
        <div className="export-summary"><ArrowDownToLine size={25} /><div><b>{doc.title}</b><span>One audiobook · 1× natural pace · generated on this PC</span></div></div>
        <div className="export-settings">
          <label className="field-label">Export model<select aria-label="Export model" value={engine} disabled={!!busy} onChange={event => setEngine(event.target.value as ExportEngine)}><option value="kokoro-cuda" disabled={!runtime?.kokoroGpu}>Kokoro · NVIDIA GPU · faster</option><option value="kokoro-cpu">Kokoro · CPU</option></select></label>
          <label className="field-label">Export voice<select aria-label="Export voice" value={voice} disabled={!!busy} onChange={event => setVoice(event.target.value)}>{!availableVoices.some(item => item.id === voice) && <option value={voice}>{findVoice(voice)?.name || voice}</option>}{availableVoices.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        </div>
        <label className="field-label">What would you like to export?<select aria-label="Audiobook range" value={range} disabled={!!busy} onChange={event => setRange(event.target.value)}><option value="all">The entire document</option><option value="remaining">From my current passage to the end</option></select></label>
        <p className="field-hint">Chapters come from this document’s contents. Approx. {Math.max(.1, workingGb).toFixed(1)} GB of temporary disk space; removed after success. Final M4B is about 43 MB per audio hour. You can keep reading, pause the export, or close Cadence and resume later.</p>
        {runtime && !runtime.tools && <p className="export-error" role="status">Local audiobook tools are unavailable. Prepare the approved offline export runtime, or use WAV.</p>}
        {jobs.some(exportActive) && <p className="field-hint">An export is already running. Pause it in Audio exports before starting another.</p>}
        <div className="export-actions"><button className="secondary" disabled={!window.cadence || !!busy || running || !!jobsError || !runtime?.tools} onClick={() => void compare()}>{busy === 'sample' ? <LoaderCircle size={16} className="spin" /> : <Play size={15} />} Compare a passage</button>{busy === 'sample' && <button className="text-button" onClick={() => { cancelled.current = true; void window.cadence?.controlExport('sample', 'pause').catch(() => {}); }}>Stop comparison</button>}<button className="primary" disabled={!window.cadence || !!busy || running || !!jobsError || !runtime?.tools} onClick={() => { cancelled.current = false; void perform(async () => { const job = await window.cadence!.createExport(request()); if (job) onManage(); }, 'create'); }}><ArrowDownToLine size={16} /> Create M4B audiobook</button></div>
      </> : <p>Open a document to create a new audiobook. Your saved exports are below.</p>}
      {!!samples.length && <section className="export-samples" aria-label="Voice comparisons">{samples.map(sample => <div key={sample.url}><b>{sample.name}</b><span>{sample.generationMs / 1000 < 10 ? (sample.generationMs / 1000).toFixed(1) : Math.round(sample.generationMs / 1000)}s to create {Math.round(sample.audioSeconds)}s of audio · model load {(sample.loadMs / 1000).toFixed(1)}s</span><audio controls preload="metadata" src={sample.url} /><details><summary>Compared text</summary><p>{sample.text}</p></details></div>)}</section>}
      <div className="modal-footer"><button className="secondary" onClick={onClose}>{doc ? 'Continue reading' : 'Close'}</button><button className="text-button" onClick={onManage}>View audio exports{jobs.length ? ` (${jobs.length})` : ''}</button></div>
    </>}
    {(error || jobsError) && <p className="export-error" role="alert">{error || jobsError}</p>}
  </div>;
}
