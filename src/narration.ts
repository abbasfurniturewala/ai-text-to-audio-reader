import processorUrl from '@soundtouchjs/audio-worklet/processor?url';
import { synthesize, speechBuffer } from './audio';
import { isHeading } from './paragraphs';
import type { Segment, SpeechRequest } from './types';

export type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused';
interface Output {
  input: AudioNode;
  setSpeed(speed: number): void;
  dispose(): void;
}
interface Prepared { buffer: AudioBuffer; offset: number; duration: number }
interface Scheduled {
  index: number; source: AudioBufferSourceNode; start: number; end: number;
  offset: number; duration: number; rate: number;
}
interface Options {
  segments: Segment[];
  request: Omit<SpeechRequest, 'text'>;
  speed: number;
  startupSeconds?: number;
  onState(state: PlaybackState): void;
  onPosition(index: number): void;
  onProgress(fraction: number): void;
  onBuffer(seconds: number): void;
  onError(message: string): void;
  createContext?: () => AudioContext;
  createOutput?: (context: AudioContext, speed: number) => Promise<Output>;
  load?: (request: SpeechRequest, context: AudioContext) => Promise<AudioBuffer>;
}

async function createOutput(context: AudioContext, speed: number): Promise<Output> {
  const { SoundTouchNode } = await import('@soundtouchjs/audio-worklet');
  await SoundTouchNode.register(context, processorUrl);
  const node = new SoundTouchNode({ context, outputChannelCount: 1 });
  node.playbackRate.value = speed;
  node.connect(context.destination);
  return { input: node, setSpeed: value => { node.playbackRate.value = value; }, dispose: () => { node.disconnect(); node.port.close(); } };
}

// Trim only long, near-silent edge padding. Keep breathing room, quiet speech
// and internal sentence pauses. This avoids stacking two clips' dead padding.
export function speechBounds(samples: Float32Array, rate: number, lead = .06, tail = .12): { offset: number; duration: number } {
  const block = Math.max(1, Math.round(rate * .01));
  const audible = (start: number) => {
    let power = 0;
    const end = Math.min(samples.length, start + block);
    for (let i = start; i < end; i++) power += samples[i] * samples[i];
    return power / (end - start) > .00000016; // -68 dB RMS
  };
  let first = 0, last = samples.length;
  while (first < last && !audible(first)) first += block;
  if (first >= last) return { offset: 0, duration: samples.length / rate };
  while (last > first && !audible(Math.max(first, last - block))) last -= block;
  const start = first > rate * Math.max(.18, lead) ? Math.max(0, first - Math.round(rate * lead)) : 0;
  const end = samples.length - last > rate * Math.max(.22, tail) ? Math.min(samples.length, last + Math.round(rate * tail)) : samples.length;
  return { offset: start / rate, duration: (end - start) / rate };
}

/** A bounded look-ahead queue. Clip handoffs use the audio clock, never onended. */
export class BufferedNarrator {
  private context: AudioContext | undefined;
  private output: Output | undefined;
  private prepared = new Map<number, Prepared>();
  private scheduled: Scheduled[] = [];
  private nextPrepare = 0;
  private nextSchedule = 0;
  private startIndex = 0;
  private firstOffset = 0;
  private lastPosition = -1;
  private speed: number;
  private state: PlaybackState = 'idle';
  private generation = 0;
  private filling = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private pendingError: string | undefined;
  private recovering = true;
  private abort = new AbortController();
  completed = false;

  constructor(private options: Options) { this.speed = options.speed; }

  private setState(state: PlaybackState) {
    if (this.state !== state) { this.state = state; this.options.onState(state); }
  }

  async start(index: number, offset = 0) {
    this.stop();
    this.abort = new AbortController();
    const token = this.generation;
    if (!this.options.segments[index]) return;
    this.completed = false;
    this.startIndex = this.nextPrepare = this.nextSchedule = index;
    this.firstOffset = Math.max(0, offset);
    this.lastPosition = index;
    this.options.onPosition(index);
    this.setState('loading');
    try {
      const context = this.options.createContext?.() || new AudioContext({ sampleRate: 24000 });
      this.context = context;
      await context.resume();
      const output = await (this.options.createOutput || createOutput)(context, this.speed);
      if (token !== this.generation) { output.dispose(); return; }
      this.output = output;
      this.timer = setInterval(() => this.tick(), 40);
      void this.fill(token);
    } catch (error) { if (token === this.generation) this.fail(error); }
  }

  stop() {
    this.abort.abort();
    this.generation++;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.clearSources();
    this.output?.dispose(); this.output = undefined;
    if (this.context) void this.context.close().catch(() => {});
    this.context = undefined;
    this.prepared.clear();
    this.filling = false; this.pendingError = undefined; this.recovering = true;
    this.setState('idle'); this.options.onProgress(0); this.options.onBuffer(0);
  }

  private clearSources() {
    for (const clip of this.scheduled) { try { clip.source.stop(); } catch { /* Already stopped. */ } clip.source.disconnect(); }
    this.scheduled = [];
  }

  private availableSeconds() {
    let seconds = 0;
    for (let i = this.nextSchedule; this.prepared.has(i); i++) {
      const clip = this.prepared.get(i)!;
      seconds += Math.max(0, clip.duration - (i === this.startIndex ? this.firstOffset : 0)) / this.speed;
    }
    return seconds;
  }

  private scheduleReady() {
    const context = this.context, output = this.output;
    if (!context || !output || this.state === 'idle') return;
    const tail = this.scheduled.at(-1);
    if (tail && tail.end < context.currentTime && this.nextSchedule < this.options.segments.length) this.recovering = true;
    const preparedCount = this.nextPrepare - this.nextSchedule;
    if (this.recovering && this.availableSeconds() < (this.options.startupSeconds ?? 0)
      && this.nextPrepare < this.options.segments.length && preparedCount < 12 && !this.pendingError) return;
    if (!this.prepared.has(this.nextSchedule)) return;
    let at = Math.max(tail?.end || 0, context.currentTime + .06);
    if (tail && tail.end >= context.currentTime) at = tail.end;
    while (this.prepared.has(this.nextSchedule)) {
      const index = this.nextSchedule++;
      const clip = this.prepared.get(index)!;
      const offset = Math.max(0, Math.min(clip.duration - .001, index === this.startIndex ? this.firstOffset : 0));
      const duration = Math.max(.001, clip.duration - offset);
      const source = context.createBufferSource();
      source.buffer = clip.buffer; source.playbackRate.value = this.speed;
      source.connect(output.input);
      source.start(at, clip.offset + offset, duration);
      this.scheduled.push({ index, source, start: at, end: at + duration / this.speed, offset, duration, rate: this.speed });
      at += duration / this.speed;
    }
    this.recovering = false;
    if (this.state !== 'paused') this.setState('playing');
  }

  private async fill(token: number) {
    if (this.filling || !this.context || this.pendingError || this.state === 'idle') return;
    this.filling = true;
    const context = this.context;
    try {
      while (token === this.generation && this.nextPrepare < this.options.segments.length) {
        const now = context.currentTime;
        const ahead = Math.max(0, (this.scheduled.at(-1)?.end || now) - now) + this.availableSeconds();
        const active = this.scheduled.find(clip => clip.end > now)?.index ?? this.nextSchedule;
        if (this.nextPrepare - active >= 12 || ahead >= Math.max(20, (this.options.startupSeconds ?? 0) + 10)) break;
        const index = this.nextPrepare;
        const request = { ...this.options.request, text: this.options.segments[index].text };
        const buffer = await (this.options.load ? this.options.load(request, context) :
          synthesize(request, { signal: this.abort.signal, priority: this.scheduled.length ? 'ahead' : 'interactive' }).then(speech => speechBuffer(speech, context)));
        if (token !== this.generation) return;
        if (!buffer.length) throw new Error('The voice engine returned empty audio. Try this passage again.');
        const seg = this.options.segments[index], next = this.options.segments[index + 1];
        const lastSeg = (seg as { parts?: { segment: number }[] }).parts?.at(-1)?.segment;
        const nextSeg = (next as { parts?: { segment: number }[] } | undefined)?.parts?.[0]?.segment;
        const headingClip = Boolean(seg.heading || (!/\n/.test(seg.text) && isHeading(seg.text)));
        const paragraphEnd = !next || (lastSeg !== undefined && nextSeg !== undefined && lastSeg !== nextSeg);
        const realSpeech = buffer.sampleRate >= 8000;
        const bounds = speechBounds(buffer.getChannelData(0), buffer.sampleRate, realSpeech ? .10 : .06, realSpeech ? (headingClip ? .64 : paragraphEnd ? .54 : .42) : .12);
        this.prepared.set(index, { buffer, ...bounds });
        this.nextPrepare++;
        this.scheduleReady();
      }
    } catch (error) {
      if (token === this.generation) {
        this.pendingError = error instanceof Error ? error.message : 'Speech generation failed.';
        this.scheduleReady();
        if (!this.scheduled.length) this.fail(error);
      }
    } finally { if (token === this.generation) this.filling = false; }
  }

  private tick() {
    const context = this.context;
    if (!context || this.state === 'idle') return;
    const now = context.currentTime;
    const current = this.scheduled.find(clip => clip.start <= now && clip.end > now);
    if (current) {
      if (this.lastPosition !== current.index) { this.lastPosition = current.index; this.options.onPosition(current.index); }
      const clip = this.prepared.get(current.index)!;
      this.options.onProgress(Math.min(1, (current.offset + (now - current.start) * current.rate) / clip.duration));
      for (const [index] of this.prepared) { if (index < current.index - 2) this.prepared.delete(index); }
      this.scheduled = this.scheduled.filter(clip => { if (clip.index < current.index) { clip.source.disconnect(); return false; } return true; });
    }
    const tail = this.scheduled.at(-1);
    this.options.onBuffer(Math.max(0, (tail?.end || now) - now) + this.availableSeconds());
    if (tail && now >= tail.end) {
      if (this.nextSchedule >= this.options.segments.length) {
        if (now >= tail.end + .3) {
          const finalIndex = this.options.segments.length - 1;
          this.stop(); this.completed = true;
          this.options.onPosition(finalIndex); this.options.onProgress(1);
        }
        return;
      }
      if (this.pendingError) { this.fail(new Error(this.pendingError)); return; }
      if (this.state !== 'paused') this.setState('loading');
    }
    void this.fill(this.generation);
  }

  async pause() {
    if (!this.context || this.state !== 'playing') return;
    const context = this.context;
    this.setState('paused');
    try { await context.suspend(); } catch (error) { if (this.context === context) this.fail(error); }
  }
  async resume() {
    if (!this.context || this.state !== 'paused') return;
    const context = this.context;
    try { await context.resume(); if (this.context === context) this.setState('playing'); }
    catch (error) { if (this.context === context) this.fail(error); }
  }

  setSpeed(speed: number) {
    if (speed === this.speed) return;
    const context = this.context;
    if (!context || !this.output || !this.scheduled.length) { this.speed = speed; this.output?.setSpeed(speed); return; }
    const now = context.currentTime;
    const active = this.scheduled.find(clip => clip.end > now) || this.scheduled.at(-1)!;
    const offset = active.offset + Math.max(0, now - active.start) * active.rate;
    this.clearSources();
    this.startIndex = this.nextSchedule = active.index; this.firstOffset = offset;
    this.speed = speed; this.output.setSpeed(speed);
    this.recovering = false;
    this.scheduleReady();
    void this.fill(this.generation);
  }

  seekSeconds(seconds: number) {
    const context = this.context;
    if (!context) return false;
    const now = context.currentTime;
    const active = this.scheduled.find(clip => clip.start <= now && clip.end > now);
    if (!active) return false;
    let index = active.index;
    let offset = active.offset + (now - active.start) * active.rate + seconds * this.speed;
    while (offset < 0 && this.prepared.has(index - 1)) { offset += this.prepared.get(--index)!.duration; }
    while (this.prepared.has(index) && offset >= this.prepared.get(index)!.duration && index + 1 < this.options.segments.length) { offset -= this.prepared.get(index++)!.duration; }
    if (!this.prepared.has(index)) { void this.start(index); return true; }
    const wasPaused = this.state === 'paused';
    this.clearSources();
    this.startIndex = this.nextSchedule = index; this.firstOffset = Math.max(0, offset); this.recovering = false;
    this.lastPosition = index; this.options.onPosition(index); this.options.onProgress(this.firstOffset / this.prepared.get(index)!.duration);
    this.scheduleReady();
    if (wasPaused) this.setState('paused');
    void this.fill(this.generation);
    return true;
  }

  private fail(error: unknown) {
    this.stop();
    this.options.onError(error instanceof Error ? error.message : 'Audio playback failed.');
  }
}
