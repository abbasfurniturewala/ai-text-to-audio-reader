import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BufferedNarrator, speechBounds } from '../src/narration';

function buffer(seconds = 2, sampleRate = 1000) {
  const samples = new Float32Array(seconds * sampleRate).fill(.1);
  return { length: samples.length, duration: seconds, sampleRate, getChannelData: () => samples } as unknown as AudioBuffer;
}
class Context {
  currentTime = 0;
  state = 'running';
  closed = false;
  nodes: Array<{ buffer: AudioBuffer | null; playbackRate: { value: number }; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
  createBufferSource() {
    const node = { buffer: null, playbackRate: { value: 1 }, start: vi.fn(), stop: vi.fn(), connect: vi.fn(), disconnect: vi.fn() };
    this.nodes.push(node); return node;
  }
  async resume() { this.state = 'running'; }
  async suspend() { this.state = 'suspended'; }
  async close() { this.closed = true; }
}
function harness(count = 6, load = vi.fn(async () => buffer()), startupSeconds = 4) {
  const context = new Context();
  const callbacks = { onState: vi.fn(), onPosition: vi.fn(), onProgress: vi.fn(), onBuffer: vi.fn(), onError: vi.fn() };
  const output = { input: {} as AudioNode, setSpeed: vi.fn(), dispose: vi.fn() };
  const player = new BufferedNarrator({
    segments: Array.from({ length: count }, (_, index) => ({ text: `Passage ${index}`, page: 1 })),
    request: { engine: 'local', voice: 'af_heart', model: 'eleven_multilingual_v2' },
    speed: 1, startupSeconds, ...callbacks, load,
    createContext: () => context as unknown as AudioContext,
    createOutput: async () => output,
  });
  return { context, callbacks, output, player, load };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('continuous narration queue', () => {
  it('quick start plays the first ready phrase without waiting for future generation', async () => {
    const resolvers: Array<(clip: AudioBuffer) => void> = [];
    const load = vi.fn(() => new Promise<AudioBuffer>(resolve => resolvers.push(resolve)));
    const { player, context, callbacks } = harness(5, load, 0);
    await player.start(0);
    resolvers.shift()!(buffer(2)); await vi.advanceTimersByTimeAsync(0);
    expect(context.nodes).toHaveLength(1);
    expect(callbacks.onState).toHaveBeenLastCalledWith('playing');
    expect(load).toHaveBeenCalledTimes(2);
    resolvers.shift()!(buffer(4)); await vi.advanceTimersByTimeAsync(0);
    expect(context.nodes[1].start.mock.calls[0][0]).toBeCloseTo(2.06, 10);
    player.stop();
  });
  it('prepares audio ahead and schedules exact, gapless clip boundaries', async () => {
    const { player, context, callbacks } = harness();
    await player.start(0); await vi.advanceTimersByTimeAsync(0);
    expect(context.nodes).toHaveLength(6);
    for (let i = 1; i < context.nodes.length; i++) {
      const previous = context.nodes[i - 1].start.mock.calls[0];
      const current = context.nodes[i].start.mock.calls[0];
      expect(current[0]).toBeCloseTo(previous[0] + previous[2], 10);
    }
    context.currentTime = 2.2; await vi.advanceTimersByTimeAsync(40);
    expect(callbacks.onPosition).toHaveBeenLastCalledWith(1);
    expect(callbacks.onState.mock.calls.map(([state]) => state)).toEqual(['loading', 'playing']);
    player.stop();
  });

  it('does not start a short heading before a useful reserve has been prepared', async () => {
    const resolvers: Array<(clip: AudioBuffer) => void> = [];
    const load = vi.fn(() => new Promise<AudioBuffer>(resolve => resolvers.push(resolve)));
    const { player, context } = harness(5, load, 4);
    await player.start(0);
    resolvers.shift()!(buffer(.2)); await vi.advanceTimersByTimeAsync(0);
    expect(context.nodes).toHaveLength(0);
    resolvers.shift()!(buffer(2)); await vi.advanceTimersByTimeAsync(0);
    expect(context.nodes).toHaveLength(0);
    resolvers.shift()!(buffer(2)); await vi.advanceTimersByTimeAsync(0);
    expect(context.nodes).toHaveLength(3);
    player.stop();
  });

  it('bounds speculative generation for books with many tiny paragraphs', async () => {
    const { player, context, load } = harness(1000, vi.fn(async () => buffer(.2)), 12);
    await player.start(0); await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(12);
    expect(context.nodes).toHaveLength(12);
    player.stop();
  });

  it('suspends and resumes the same audio clock without regenerating speech', async () => {
    const { player, context, callbacks, load } = harness();
    await player.start(0); await vi.advanceTimersByTimeAsync(0);
    context.currentTime = .6; await vi.advanceTimersByTimeAsync(40);
    await player.pause();
    const fraction = callbacks.onProgress.mock.lastCall?.[0];
    await vi.advanceTimersByTimeAsync(2000);
    expect(context.state).toBe('suspended');
    expect(callbacks.onProgress.mock.lastCall?.[0]).toBe(fraction);
    await player.resume(); expect(context.state).toBe('running');
    expect(load).toHaveBeenCalledTimes(6);
    player.stop();
  });

  it('reschedules cached audio with pitch compensation after a speed change', async () => {
    const { player, context, output, load } = harness();
    await player.start(0); await vi.advanceTimersByTimeAsync(0);
    context.currentTime = .56;
    player.setSpeed(1.5);
    expect(output.setSpeed).toHaveBeenLastCalledWith(1.5);
    expect(context.nodes[0].stop).toHaveBeenCalled();
    const next = context.nodes[6], following = context.nodes[7];
    expect(next.playbackRate.value).toBe(1.5);
    expect(next.start.mock.calls[0][1]).toBeCloseTo(.5, 6);
    expect(following.start.mock.calls[0][0]).toBeCloseTo(next.start.mock.calls[0][0] + 1.5 / 1.5, 10);
    expect(load).toHaveBeenCalledTimes(6);
    player.stop();
  });

  it('cancels a pending generation without letting stale audio start', async () => {
    let resolve!: (clip: AudioBuffer) => void;
    const { player, context, callbacks } = harness(5, vi.fn(() => new Promise<AudioBuffer>(r => { resolve = r; })));
    await player.start(0); player.stop();
    resolve(buffer()); await vi.advanceTimersByTimeAsync(0);
    expect(context.nodes).toHaveLength(0); expect(context.closed).toBe(true);
    expect(callbacks.onState).toHaveBeenLastCalledWith('idle');
  });

  it('finishes at 100 percent and drains the processor before closing', async () => {
    const { player, context, callbacks } = harness(1);
    await player.start(0); await vi.advanceTimersByTimeAsync(0);
    context.currentTime = 2.1; await vi.advanceTimersByTimeAsync(40);
    expect(context.closed).toBe(false);
    context.currentTime = 2.4; await vi.advanceTimersByTimeAsync(40);
    expect(context.closed).toBe(true); expect(player.completed).toBe(true);
    expect(callbacks.onProgress).toHaveBeenLastCalledWith(1);
  });

  it('handles a voice failure without an unhandled promise or a stuck loading state', async () => {
    const { player, callbacks } = harness(3, vi.fn(async () => { throw new Error('Voice unavailable'); }));
    await player.start(0); await vi.advanceTimersByTimeAsync(0);
    expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith('Voice unavailable');
    expect(callbacks.onState).toHaveBeenLastCalledWith('idle');
  });

  it('recovers from a genuine underrun by preparing a fresh reserve', async () => {
    const resolvers: Array<(clip: AudioBuffer) => void> = [];
    const load = vi.fn(() => new Promise<AudioBuffer>(resolve => resolvers.push(resolve)));
    const { player, context, callbacks } = harness(4, load, 4);
    await player.start(0);
    resolvers.shift()!(buffer(4)); await vi.advanceTimersByTimeAsync(0);
    expect(context.nodes).toHaveLength(1);
    context.currentTime = 5; await vi.advanceTimersByTimeAsync(40);
    expect(callbacks.onState).toHaveBeenLastCalledWith('loading');
    resolvers.shift()!(buffer(2)); await vi.advanceTimersByTimeAsync(0);
    expect(context.nodes).toHaveLength(1);
    resolvers.shift()!(buffer(2)); await vi.advanceTimersByTimeAsync(0);
    expect(context.nodes).toHaveLength(3);
    expect(callbacks.onState).toHaveBeenLastCalledWith('playing');
    player.stop();
  });

  it('seeks across prepared passage boundaries without new generation', async () => {
    const { player, context, load, callbacks } = harness();
    await player.start(0); await vi.advanceTimersByTimeAsync(0);
    context.currentTime = .56;
    expect(player.seekSeconds(3)).toBe(true);
    expect(callbacks.onPosition).toHaveBeenLastCalledWith(1);
    expect(context.nodes[6].start.mock.calls[0][1]).toBeCloseTo(1.5);
    expect(load).toHaveBeenCalledTimes(6);
    player.stop();
  });
});

describe('speech boundary padding', () => {
  it('removes long edge silence but keeps a little space around speech', () => {
    const samples = new Float32Array(3000); samples.fill(.05, 500, 2000);
    const bounds = speechBounds(samples, 1000);
    expect(bounds.offset).toBeCloseTo(.44); expect(bounds.duration).toBeCloseTo(1.68);
  });
  it('preserves quiet speech, short natural pauses, and entirely silent clips', () => {
    expect(speechBounds(new Float32Array(1000).fill(.0005), 1000)).toEqual({ offset: 0, duration: 1 });
    expect(speechBounds(new Float32Array(1000), 1000)).toEqual({ offset: 0, duration: 1 });
    const samples = new Float32Array(1000); samples.fill(.1, 100, 900);
    expect(speechBounds(samples, 1000)).toEqual({ offset: 0, duration: 1 });
  });
});
