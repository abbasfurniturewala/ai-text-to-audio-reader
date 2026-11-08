import { describe, expect, it } from 'vitest';
import { ffmpegProgress, encodingProgress, finishingProgress } from '../desktop/export-encoding.mjs';
import { aacFrames, aacTiming } from '../desktop/audiobook-encoding.mjs';

describe('audiobook file creation progress', () => {
  it('handles split records, unavailable speed and the legacy microsecond key without retaining unlimited text', () => {
    const records = [], read = ffmpegProgress(record => records.push(record));
    read(Buffer.from('out_time_us=120')); read(Buffer.from('00000\r\nspeed=N/A\r\nprogress=continue\r\nout_time_ms=25000000\nspeed=50.0x\nprogress=end\n'));
    expect(records).toEqual([{ seconds: 12, done: false }, { seconds: 25, speed: 50, done: true }]);
    read('out_time_us=invalid\nprogress=continue\n'); read('x'.repeat(10000)); read('out_time_us=26000000\nprogress=end\n');
    expect(records.at(-1)).toEqual({ seconds: 26, done: true }); expect(records).toHaveLength(3);
  });
  it('reports file progress independently of narration and estimates from measured elapsed time', () => {
    expect(encodingProgress({ seconds: 30 }, 120, 3)).toEqual({ phase: 'encoding', encodedSeconds: 30, totalSeconds: 120, percent: 25, remainingSeconds: 9 });
    expect(encodingProgress({ seconds: 0 }, 120, 1)).not.toHaveProperty('remainingSeconds');
    expect(encodingProgress({ seconds: 121 }, 120, 12)).toMatchObject({ phase: 'indexing', encodedSeconds: 120, percent: 99.9, remainingSeconds: 0 });
    expect(encodingProgress({ seconds: 90 }, 120, 3, 60)).toMatchObject({ remainingSeconds: 3 });
    expect(encodingProgress({ seconds: 60 }, 120, 3, 60)).not.toHaveProperty('remainingSeconds');
  });
  it('extracts complete mono 24k AAC-LC frames and rejects corrupt, truncated and incompatible sections', () => {
    const packet = Buffer.from([255, 241, 88, 64, 1, 127, 252, 11, 22, 33, 44]);
    expect(aacFrames(Buffer.concat([packet, packet])).map(item => [...item])).toEqual([[...packet], [...packet]]);
    for (const offset of [0, 2, 3, 4, 6]) { const bad = Buffer.from(packet); bad[offset] ^= offset === 6 ? 1 : 255; expect(() => aacFrames(bad)).toThrow(); }
    expect(() => aacFrames(packet.subarray(0, 10))).toThrow(/incomplete/);
    expect(() => aacFrames(packet.subarray(0, 6))).toThrow();
  });
  it('trims one global priming frame and exactly the last partial frame even beyond 32-bit durations', () => {
    expect(aacTiming(1024)).toContain('eq(N\\,1)\\,1024');
    expect(aacTiming(1025)).toContain('eq(N\\,2)\\,1');
    expect(aacTiming(24000 * 60 * 60 * 60 + 17)).toContain('pts=(N*1024-1024)/24000/TB');
    for (const value of [0, -1, .5, Infinity]) expect(() => aacTiming(value)).toThrow();
  });
  it('distinguishes repeated heartbeats from real advancement so a stalled encoder stays detectable', () => {
    const start = finishingProgress(undefined, { phase: 'encoding', encodedSeconds: 0 }, 1000);
    const unchanged = finishingProgress(start, { phase: 'encoding', encodedSeconds: 0 }, 91000);
    expect(unchanged).toEqual(start);
    expect(finishingProgress(unchanged, { phase: 'encoding', encodedSeconds: 5 }, 92000)).toMatchObject({ startedAt: 1000, updatedAt: 92000 });
    expect(finishingProgress(unchanged, { phase: 'checking' }, 93000)).toMatchObject({ startedAt: 1000, updatedAt: 93000, phase: 'checking' });
  });
});
