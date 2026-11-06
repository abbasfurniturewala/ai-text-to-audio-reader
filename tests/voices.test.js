import { describe, expect, it } from 'vitest';
import { blendStyle, parseBlend } from '../desktop/speech-voice.mjs';
describe('voice style blending', () => {
  it('validates voices and ratios before reading any voice file', () => {
    expect(parseBlend('blend_af_heart_bf_emma_65', { af_heart: {}, bf_emma: {} })).toEqual({ primary: 'af_heart', secondary: 'bf_emma', ratio: 65 });
    for (const id of ['blend_af_missing_bf_emma_65', 'blend_af_heart_bf_emma_101', '../../voices/file']) expect(() => parseBlend(id, { af_heart: {}, bf_emma: {} })).toThrow();
  });
  it('interpolates styles with exact endpoint behavior and finite limits', () => {
    const first = new Float32Array(256).fill(1), second = new Float32Array(256).fill(-1);
    expect(blendStyle(first, second, 65)[0]).toBeCloseTo(.3);
    expect(blendStyle(first, second, 100)).toEqual(first); expect(blendStyle(first, second, 0)).toEqual(second);
    expect(() => blendStyle(first, second, NaN)).toThrow(); expect(() => blendStyle(new Float32Array(1), second, 50)).toThrow();
  });
});
