import { describe, expect, it } from 'vitest';
import { clockTime, wavBytes } from '../src/audio';
describe('WAV export', () => {
  it('writes a valid mono PCM header and clamps audio without overflowing', () => {
    const bytes = wavBytes(new Float32Array([-2, -1, 0, .5, 1, 2]), 24000);
    const view = new DataView(bytes.buffer);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF');
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe('WAVE');
    expect(view.getUint32(4, true)).toBe(bytes.length - 8);
    expect(view.getUint32(24, true)).toBe(24000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(12);
    expect(view.getInt16(44, true)).toBe(-32768);
    expect(view.getInt16(54, true)).toBe(32767);
  });
  it('formats unknown and negative playback time safely', () => {
    expect(clockTime(NaN)).toBe('0:00'); expect(clockTime(-3)).toBe('0:00'); expect(clockTime(125)).toBe('2:05');
  });
});
