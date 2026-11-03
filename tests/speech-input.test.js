import { describe, expect, it } from 'vitest';
import { guardTokenWindow, generateComplete } from '../desktop/speech-input.mjs';

describe('voice context safety', () => {
  it('disables silent truncation before the model runs', () => {
    let received;
    const tts = guardTokenWindow({ tokenizer: (text, options) => { received = options; return { input_ids: { dims: [1, text.length] } }; } });
    expect(tts.tokenizer('x'.repeat(512), { truncation: true }).input_ids.dims[1]).toBe(512);
    expect(received.truncation).toBe(false);
    expect(() => tts.tokenizer('x'.repeat(513), {})).toThrow('context');
  });
  it('keeps fitting sentences intact, splits only overflow, and includes every word', async () => {
    const requests = [];
    const tts = { generate: async text => {
      if (text.length > 100) throw Object.assign(new Error(), { code: 'VOICE_CONTEXT' });
      requests.push(text);
      return { audio: new Float32Array(text.length).fill(.2), sampling_rate: 24000 };
    } };
    const fitting = 'A sentence that fits, even with a comma, is one utterance.';
    await generateComplete(tts, fitting, {});
    expect(requests).toEqual([fitting]);
    requests.length = 0;
    const long = 'Many carefully chosen words in the first clause, '.repeat(12) + 'then the sentence ends.';
    const audio = await generateComplete(tts, long, {});
    expect(requests.join(' ')).toBe(long);
    expect(audio.audio.length).toBe(requests.reduce((sum, text) => sum + text.length, 0));
  });
  it('honors cancellation between oversized-sentence parts and propagates model errors', async () => {
    let calls = 0;
    const tts = { generate: async text => {
      calls++;
      if (text.length > 10) throw Object.assign(new Error(), { code: 'VOICE_CONTEXT' });
      return { audio: new Float32Array(10), sampling_rate: 24000 };
    } };
    await expect(generateComplete(tts, 'one two three four five six', {}, () => { if (calls >= 2) throw new Error('cancelled'); })).rejects.toThrow('cancelled');
    await expect(generateComplete({ generate: async () => { throw new Error('model failed'); } }, 'Hello.', {})).rejects.toThrow('model failed');
  });
  it('adds terminal punctuation to unpunctuated heading breaks before synthesis', async () => {
    const requests = [];
    const tts = { generate: async text => { requests.push(text); return { audio: new Float32Array(8), sampling_rate: 24000 }; } };
    await generateComplete(tts, 'Chapter one\n\nA small beginning.', {});
    await generateComplete(tts, 'Already punctuated.\n\nNext sentence.', {});
    expect(requests).toEqual(['Chapter one.\n\nA small beginning.', 'Already punctuated.\n\nNext sentence.']);
  });
});
