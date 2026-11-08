import type { ExportJob } from './types';

export interface ExportPoint { at: number; characters: number; audio: number; encoded: number }
export function exportPoints(points: ExportPoint[], job: ExportJob, now: number): ExportPoint[] {
  if (job.status !== 'running') return [];
  const point = { at: now, characters: job.completedCharacters || 0, audio: job.audioSeconds, encoded: (job.encodedSamples || 0) / 24000 }, last = points.at(-1);
  if (![point.at, point.characters, point.audio, point.encoded].every(Number.isFinite)) return [];
  if (last && (now < last.at || point.characters < last.characters || point.audio < last.audio || point.encoded < last.encoded)) return [point];
  if (last && point.characters === last.characters && point.encoded === last.encoded) return points;
  const recent = points.filter(item => now - item.at <= 120000);
  if (recent.length > 1 && Math.floor(last!.at / 4000) === Math.floor(now / 4000)) recent.pop();
  return [...recent, point].slice(-32);
}
export function exportRemaining(job: ExportJob, points: ExportPoint[], now: number): number | undefined {
  if (job.status === 'encoding') {
    const file = job.finishing;
    if (!file || !['encoding', 'assembling'].includes(file.phase) || !Number.isFinite(file.remainingSeconds) || now < file.updatedAt || now - file.updatedAt > 90000) return;
    const remaining = file.remainingSeconds! - (now - file.updatedAt) / 1000;
    return remaining > 0 ? remaining : undefined;
  }
  if (job.status !== 'running' || !Number.isFinite(job.totalCharacters)) return;
  const first = points[0], last = points.at(-1);
  if (!first || !last || now < last.at || now - last.at > 90000) return;
  const elapsed = (last.at - first.at) / 1000, characters = last.characters - first.characters, audio = last.audio - first.audio, encoded = last.encoded - first.encoded;
  if (elapsed < 2 || characters <= 0 || audio <= 0 || encoded <= 0) return;
  const left = Math.max(0, job.totalCharacters! - last.characters);
  // Synthesis and compression overlap; estimate the slower path rather than adding both.
  const speech = left * elapsed / characters, compression = Math.max(0, last.audio + left * audio / characters - last.encoded) * elapsed / encoded;
  const remaining = Math.max(speech, compression) - (now - last.at) / 1000;
  return Number.isFinite(remaining) && remaining > 0 ? remaining : undefined;
}
export function exportEtaLabel(seconds: number) {
  const minutes = Math.ceil(seconds / 60);
  return seconds < 60 ? 'Less than 1m left' : minutes < 60 ? `About ${minutes}m left` : `About ${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''} left`;
}
export function exportFinishTime(now: number, seconds: number) {
  const finish = new Date(now + seconds * 1000), today = new Date(now);
  return finish.toDateString() === today.toDateString() ? finish.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : finish.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
