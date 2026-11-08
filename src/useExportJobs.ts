import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExportJob } from './types';

export const exportActive = (job: ExportJob) => ['loading', 'running', 'encoding'].includes(job.status);
export const exportSupported = (job: ExportJob) => ['kokoro-cuda', 'kokoro-cpu'].includes(job.engine);
export const exportError = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
export function useExportJobs() {
  const [jobs, setJobs] = useState<ExportJob[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const revision = useRef(0), mounted = useRef(false);
  const refresh = useCallback(async () => {
    const before = revision.current;
    try {
      if (!window.cadence) throw new Error('Open the desktop app to manage your saved exports.');
      const result = await window.cadence.exportJobs();
      if (!mounted.current) return;
      // A progress event can arrive while the initial disk list is in flight.
      setJobs(previous => (before === revision.current ? result : [...previous, ...result.filter(job => !previous.some(item => item.id === job.id))]).sort((a, b) => b.created - a.created));
      setError('');
    } catch (reason) { if (mounted.current) setError(exportError(reason)); }
    finally { if (mounted.current) setLoading(false); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = window.cadence?.onExportProgress(message => {
      if (message.job) { revision.current++; setJobs(previous => [message.job!, ...previous.filter(item => item.id !== message.job!.id)].sort((a, b) => b.created - a.created)); }
      if (message.error) void refresh().finally(() => { if (mounted.current) setError(exportError(message.error)); });
    });
    void refresh(); window.addEventListener('focus', refresh);
    return () => { mounted.current = false; unsubscribe?.(); window.removeEventListener('focus', refresh); };
  }, [refresh]);
  return { jobs, loading, error, refresh };
}
