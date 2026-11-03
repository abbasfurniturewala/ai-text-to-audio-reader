import { useCallback, useEffect, useRef, useState } from 'react';
import { BufferedNarrator, type PlaybackState } from './narration';
import { synthesize } from './audio';
import { speechPlan, chunkPosition } from './speechPlan';
import type { ReaderDocument } from './types';

export function usePlayer(doc: ReaderDocument | undefined, voice: string, speed: number,
  onPosition: (index: number) => void, onError: (message: string) => void, startupSeconds = 0, prepareEnabled = true) {
  const [state, setState] = useState<PlaybackState>('idle');
  const [fraction, setFraction] = useState(0);
  const [bufferedSeconds, setBufferedSeconds] = useState(0);
  const session = useRef<BufferedNarrator | undefined>(undefined);
  const mounted = useRef(true);
  const preparation = useRef<{ abort: AbortController; first: string } | undefined>(undefined);
  const current = useRef({ doc, voice, speed, onPosition, onError, startupSeconds });
  current.current = { doc, voice, speed, onPosition, onError, startupSeconds };
  const stop = useCallback(() => { session.current?.stop(); session.current = undefined; setState('idle'); setFraction(0); setBufferedSeconds(0); }, []);

  const playFrom = useCallback((index: number, character = 0) => {
    stop();
    const config = current.current;
    if (!config.doc?.segments[index]) return;
    const segments = config.doc.segments;
    const chunks = speechPlan(segments, index, character);
    if (!chunks.length) return;
    if (preparation.current?.first !== chunks[0].text) preparation.current?.abort.abort();
    let activeChunk = 0, lastPosition = -1, liveState: PlaybackState = 'idle';
    const progress = (fraction: number) => {
      const position = chunkPosition(chunks[activeChunk], fraction, segments);
      if (position.index !== lastPosition) { lastPosition = position.index; current.current.onPosition(position.index); }
      if (mounted.current) setFraction(position.fraction);
    };
    const player = new BufferedNarrator({
      segments: chunks, request: { engine: 'local', voice: config.voice },
      speed: config.speed, startupSeconds: config.startupSeconds,
      onState: value => { liveState = value; if (mounted.current) setState(value); },
      onProgress: value => { if (liveState === 'idle' && value !== 1) { if (mounted.current) setFraction(value); } else progress(value); },
      onBuffer: value => { if (mounted.current) setBufferedSeconds(value); },
      onPosition: value => { activeChunk = value; progress(0); },
      onError: message => current.current.onError(message),
    });
    session.current = player;
    void player.start(0);
  }, [stop]);
  const toggle = useCallback(() => {
    if (state === 'loading') { stop(); return; }
    if (state === 'playing') { void session.current?.pause(); return; }
    if (state === 'paused') { void session.current?.resume(); return; }
    playFrom(session.current?.completed ? 0 : current.current.doc?.position || 0);
  }, [state, stop, playFrom]);
  const jump = useCallback((index: number) => {
    const clamped = Math.max(0, Math.min((current.current.doc?.segments.length || 1) - 1, index));
    if (state === 'playing' || state === 'loading') playFrom(clamped);
    else { stop(); current.current.onPosition(clamped); }
  }, [state, playFrom, stop]);
  const seekSeconds = useCallback((offset: number) => {
    if (!session.current?.seekSeconds(offset)) jump((current.current.doc?.position || 0) + Math.sign(offset));
  }, [jump]);
  useEffect(() => { stop(); }, [doc?.id, voice, stop]);
  useEffect(() => {
    if (!doc || !voice || !prepareEnabled || !window.cadence) return;
    const abort = new AbortController();
    const chunks = speechPlan(doc.segments, doc.position, 0, 3).slice(0, 3);
    preparation.current = { abort, first: chunks[0]?.text || '' };
    const timer = setTimeout(() => {
      void (async () => {
        for (const chunk of chunks) {
          if (abort.signal.aborted) return;
          await synthesize({ text: chunk.text, engine: 'local', voice }, { signal: abort.signal, priority: 'background' });
        }
      })().catch(() => { /* Playback surfaces actionable errors; speculative work is silent. */ });
    }, 200);
    return () => { clearTimeout(timer); abort.abort(); };
    // Prepare on document/voice changes, never on each playback position update.
  }, [doc?.id, voice, prepareEnabled]);
  useEffect(() => { session.current?.setSpeed(speed); }, [speed]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; session.current?.stop(); }; }, []);
  return { state, fraction, bufferedSeconds, toggle, stop, jump, playFrom, seekSeconds };
}
