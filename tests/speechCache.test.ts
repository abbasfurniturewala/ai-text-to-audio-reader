import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSpeechCache, speechKey, synthesize } from '../src/audio';
const audio = { bytes: new Uint8Array([1, 2]), mime: 'audio/wav', sampleRate: 24000 };
afterEach(() => { clearSpeechCache(); vi.unstubAllGlobals(); });
describe('shared preparation cache', () => {
  it('uses a canonical key regardless of request property order', () => {
    expect(speechKey({ text: 'Hello', engine: 'local', voice: 'af_heart', model: 'a' })).toBe(speechKey({ voice: 'af_heart', model: 'b', engine: 'local', text: 'Hello' }));
  });
  it('shares background preparation with playback without duplicate model work', async () => {
    let resolve!: (audio: typeof audioResult) => void;
    const audioResult = audio;
    const generate = vi.fn(() => new Promise<typeof audio>(r => { resolve = r; }));
    const cancelSpeech = vi.fn(async () => {});
    vi.stubGlobal('window', { cadence: { synthesize: generate, cancelSpeech } });
    const background = new AbortController();
    const prepared = synthesize({ text: 'A shared first phrase.', engine: 'local', voice: 'af_heart', model: 'a' }, { signal: background.signal, priority: 'background' });
    const played = synthesize({ engine: 'local', voice: 'af_heart', model: 'a', text: 'A shared first phrase.' });
    const rejected = expect(prepared).rejects.toThrow('Speech cancelled');
    background.abort(); resolve(audio);
    await rejected; expect(await played).toBe(audio);
    expect(generate).toHaveBeenCalledTimes(1); expect(cancelSpeech).not.toHaveBeenCalled();
  });
  it('cancels unneeded work and allows the same text to be requested again', async () => {
    const generate = vi.fn().mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue(audio);
    const cancelSpeech = vi.fn(async () => {});
    vi.stubGlobal('window', { cadence: { synthesize: generate, cancelSpeech } });
    const abort = new AbortController();
    const request = { text: 'Discard this speculation.', engine: 'local' as const, voice: 'af_heart', model: '' };
    const first = synthesize(request, { signal: abort.signal });
    const rejected = expect(first).rejects.toThrow('Speech cancelled');
    abort.abort(); await rejected;
    expect(cancelSpeech).toHaveBeenCalledTimes(1);
    expect(await synthesize(request)).toBe(audio); expect(generate).toHaveBeenCalledTimes(2);
  });
  it('bounds retained audio by bytes while keeping recently used clips fast', async () => {
    const generate = vi.fn(async () => ({ ...audio, samples: new Float32Array(2 * 1024 * 1024) }));
    vi.stubGlobal('window', { cadence: { synthesize: generate } });
    const request = (text: string) => ({ text, engine: 'local' as const, voice: 'af_heart', model: '' });
    await synthesize(request('first'));
    await synthesize(request('second'));
    await synthesize(request('third'));
    await synthesize(request('third'));
    expect(generate).toHaveBeenCalledTimes(3);
    await synthesize(request('first'));
    expect(generate).toHaveBeenCalledTimes(4);
  });
  it('releases the previous document cache without invalidating audio already in use', async () => {
    const generate = vi.fn(async () => audio);
    vi.stubGlobal('window', { cadence: { synthesize: generate } });
    const request = { text: 'Document one.', engine: 'local' as const, voice: 'af_heart', model: '' };
    const existing = await synthesize(request);
    clearSpeechCache();
    expect(existing).toBe(audio);
    await synthesize(request);
    expect(generate).toHaveBeenCalledTimes(2);
  });
});
