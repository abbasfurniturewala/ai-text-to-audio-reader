import { describe, expect, it } from 'vitest';
import { exportPoints, exportRemaining, exportEtaLabel, exportFinishTime } from '../src/exportEta';
import type { ExportJob } from '../src/types';

const job = (values: Partial<ExportJob> = {}): ExportJob => ({ id: 'fixture', title: 'Book', engine: 'kokoro-cuda', voiceName: 'Heart', output: 'book.m4b', created: 0, status: 'running', message: '', progress: 50, audioSeconds: 120, chapterCount: 1, estimatedWorkingBytes: 0, completedCharacters: 1000, totalCharacters: 2000, encodedSamples: 24000 * 60, ...values });
describe('live export estimates', () => {
  it('accounts for the slower parallel compression path without adding overlapping work', () => {
    const points = [{ at: 1000, characters: 0, audio: 0, encoded: 0 }, { at: 11000, characters: 1000, audio: 120, encoded: 60 }];
    expect(exportRemaining(job(), points, 11000)).toBe(30);
    expect(exportRemaining(job(), points, 13000)).toBe(28);
    expect(exportRemaining(job(), [{ ...points[0] }, { ...points[1], encoded: 120 }], 11000)).toBe(10);
  });
  it('waits for measured synthesis and compression instead of using a previous run or guessing the first phrase', () => {
    const first = exportPoints([], job(), 1000);
    expect(exportRemaining(job(), first, 1000)).toBeUndefined();
    const points = exportPoints(first, job({ completedCharacters: 1200, audioSeconds: 140 }), 11000);
    expect(exportRemaining(job(), points, 11000)).toBeUndefined();
    expect(exportPoints(points, job({ status: 'paused' }), 12000)).toEqual([]);
    expect(exportPoints(points, job({ status: 'loading' }), 12000)).toEqual([]);
  });
  it('bounds timing history and resets on a clock or progress reversal', () => {
    let points = exportPoints([], job(), 0);
    for (let n = 1; n <= 100; n++) points = exportPoints(points, job({ completedCharacters: 1000 + n, encodedSamples: n * 24000 }), n * 1000);
    expect(points.length).toBeLessThanOrEqual(32); expect(points.length).toBeGreaterThan(1); expect(points.at(-1)!.at - points[0].at).toBeLessThanOrEqual(120000); expect(exportPoints(points, job(), 200000)).toHaveLength(1);
    expect(exportPoints(points, job({ completedCharacters: 2000, encodedSamples: 3000000 }), 0)).toHaveLength(1);
    expect(exportPoints(points, job({ audioSeconds: NaN }), 200000)).toEqual([]);
  });
  it('does not advance its measurement timestamp on unchanged progress or keep a stale countdown', () => {
    const points = exportPoints([], job(), 1000); expect(exportPoints(points, job(), 90000)).toBe(points);
    const measured = [{ at: 0, characters: 0, audio: 0, encoded: 0 }, { at: 10000, characters: 1000, audio: 120, encoded: 60 }];
    expect(exportRemaining(job(), measured, 101000)).toBeUndefined();
    expect(exportRemaining(job(), measured, 45000)).toBeUndefined();
    expect(exportRemaining(job(), measured, 9000)).toBeUndefined();
  });
  it('uses current file-stage progress and stops predicting during final checks and saving', () => {
    const finishing = { phase: 'assembling' as const, startedAt: 1000, updatedAt: 10000, remainingSeconds: 90 };
    expect(exportRemaining(job({ status: 'encoding', finishing }), [], 15000)).toBe(85);
    for (const phase of ['checking', 'saving', 'indexing'] as const) expect(exportRemaining(job({ status: 'encoding', finishing: { ...finishing, phase } }), [], 15000)).toBeUndefined();
    for (const remainingSeconds of [NaN, Infinity, -2, 0]) expect(exportRemaining(job({ status: 'encoding', finishing: { ...finishing, remainingSeconds } }), [], 15000)).toBeUndefined();
    expect(exportRemaining(job({ status: 'encoding', finishing }), [], 101000)).toBeUndefined();
  });
  it('never shows an ETA for paused, completed or failed jobs', () => {
    for (const status of ['paused', 'complete', 'error', 'loading'] as const) expect(exportRemaining(job({ status }), [], 10000)).toBeUndefined();
  });
  it('rounds approximate time upward and includes a date when completion crosses midnight', () => {
    expect(exportEtaLabel(59)).toBe('Less than 1m left'); expect(exportEtaLabel(60.1)).toBe('About 2m left'); expect(exportEtaLabel(3600)).toBe('About 1h left'); expect(exportEtaLabel(3661)).toBe('About 1h 2m left');
    const now = new Date(2026, 10, 7, 23, 59).getTime(); expect(exportFinishTime(now, 120)).toBe(new Date(now + 120000).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }));
  });
});
