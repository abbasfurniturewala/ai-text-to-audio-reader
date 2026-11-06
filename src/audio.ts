import type { SpeechRequest, SpeechAudio } from './types';
interface Entry { promise: Promise<SpeechAudio>; id: string; clients: number; settled: boolean; bytes: number }
const cache = new Map<string, Entry>();
const maxCacheBytes = 24 * 1024 * 1024;
function trimCache() {
  let bytes = [...cache.values()].reduce((sum, entry) => sum + entry.bytes, 0);
  for (const [key, entry] of cache) {
    if (bytes <= maxCacheBytes && cache.size <= 48) break;
    if (entry.settled && !entry.clients) { cache.delete(key); bytes -= entry.bytes; }
  }
}
export function clearSpeechCache() { cache.clear(); }
export function speechKey(request: SpeechRequest) { return JSON.stringify([request.engine || 'local', request.voice, '', request.text]); }
export async function synthesize(request: SpeechRequest, options: { signal?: AbortSignal; priority?: 'interactive' | 'ahead' | 'background' } = {}): Promise<SpeechAudio> {
  if (!window.cadence) throw new Error('Open the Cadence Windows app to use local neural voices. This browser preview shows the reading interface.');
  if (options.signal?.aborted) throw new DOMException('Speech cancelled', 'AbortError');
  const key = speechKey(request);
  let entry = cache.get(key);
  if (!entry) {
    const id = crypto.randomUUID();
    entry = { id, clients: 0, settled: false, bytes: 0, promise: Promise.resolve(undefined as unknown as SpeechAudio) };
    const created = entry;
    entry.promise = window.cadence.synthesize({ ...request, requestId: id, priority: options.priority || 'interactive' })
      .then(audio => { created.settled = true; created.bytes = audio.bytes.byteLength + (audio.samples?.byteLength || 0); trimCache(); return audio; })
      .catch(error => { if (cache.get(key) === created) cache.delete(key); throw error; });
    cache.set(key, entry);
    trimCache();
  } else {
    cache.delete(key); cache.set(key, entry);
  }
  const shared = entry;
  shared.clients++;
  return new Promise((resolve, reject) => {
    let finished = false;
    const release = () => {
      if (finished) return false;
      finished = true; shared.clients--; options.signal?.removeEventListener('abort', abort); trimCache(); return true;
    };
    const abort = () => {
      if (!release()) return;
      if (!shared.clients && !shared.settled) {
        if (cache.get(key) === shared) cache.delete(key);
        void window.cadence?.cancelSpeech(shared.id).catch(() => {});
      }
      reject(new DOMException('Speech cancelled', 'AbortError'));
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    shared.promise.then(audio => { if (release()) resolve(audio); }, error => { if (release()) reject(error); });
  });
}

export async function speechBuffer(audio: SpeechAudio, context: AudioContext): Promise<AudioBuffer> {
  if (audio.samples?.length) {
    const buffer = context.createBuffer(1, audio.samples.length, audio.sampleRate);
    buffer.getChannelData(0).set(audio.samples);
    return buffer;
  }
  return context.decodeAudioData(new Uint8Array(audio.bytes).buffer);
}
export function wavBytes(samples: Float32Array, sampleRate: number): Uint8Array {
  return wavBytesFromInt16Chunks([pcm16(samples)], sampleRate);
}
export function pcm16(samples: Float32Array, start = 0, end = samples.length): Int16Array {
  const result = new Int16Array(Math.max(0, end - start));
  for (let i = 0; i < result.length; i++) { const s = Math.max(-1, Math.min(1, samples[start + i] || 0)); result[i] = s < 0 ? s * 32768 : s * 32767; }
  return result;
}
export function wavBytesFromInt16Chunks(chunks: Int16Array[], sampleRate: number): Uint8Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  if (!Number.isInteger(sampleRate) || sampleRate <= 0 || length * 2 > 0xffffffff - 36) throw new Error('This WAV file is too large or has an invalid sample rate.');
  const bytes = new Uint8Array(44 + length * 2);
  const view = new DataView(bytes.buffer);
  const write = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  write(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, length * 2, true);
  let offset = 44;
  for (const chunk of chunks) for (const sample of chunk) { view.setInt16(offset, sample, true); offset += 2; }
  return bytes;
}
export async function decodeSpeech(audio: SpeechAudio, context: AudioContext): Promise<Float32Array> {
  const buffer = await speechBuffer(audio, context);
  const samples = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) samples[i] += data[i] / buffer.numberOfChannels;
  }
  return samples;
}
export function clockTime(seconds: number) {
  if (!Number.isFinite(seconds)) return '0:00';
  return `${Math.floor(Math.max(0, seconds) / 60)}:${Math.floor(Math.max(0, seconds) % 60).toString().padStart(2, '0')}`;
}
