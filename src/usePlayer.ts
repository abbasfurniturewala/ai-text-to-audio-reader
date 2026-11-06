import { useCallback, useEffect, useRef, useState } from 'react';
import { BufferedNarrator, prepareNarration, type PlaybackState } from './narration';
import { PlaybackContext } from './playbackContext';
import { synthesize } from './audio';
import { documentSpeechPlan, documentSpeechSource, chunkPosition, type SpeechPart } from './speechPlan';
import type { ReaderDocument } from './types';

export function usePlayer(doc: ReaderDocument | undefined, voice: string, speed: number,
  onPosition: (index: number) => void, onError: (message: string) => void, startupSeconds = 0, prepareEnabled = true) {
  const [state, setState] = useState<PlaybackState>('idle');
  const [fraction, setFraction] = useState(0);
  const [bufferedSeconds, setBufferedSeconds] = useState(0);
  const [spoken, setSpoken] = useState<{ id: string; parts: SpeechPart[] }>();
  const session = useRef<BufferedNarrator | undefined>(undefined);
  const output = useRef<PlaybackContext | undefined>(undefined);
  if (!output.current) output.current = new PlaybackContext();
  const mounted = useRef(true);
  const preparation = useRef<{ abort: AbortController; first: string } | undefined>(undefined);
  const current = useRef({ doc, voice, speed, onPosition, onError, startupSeconds });
  current.current = { doc, voice, speed, onPosition, onError, startupSeconds };
  const stop = useCallback(() => { session.current?.stop(); session.current = undefined; setState('idle'); setFraction(0); setBufferedSeconds(0); setSpoken(undefined); }, []);
  const warmOutput = useCallback(() => { void Promise.resolve().then(() => { if (mounted.current && current.current.doc && window.cadence) return prepareNarration(output.current!.prepare()); }).catch(() => {}); }, []);

  const playFrom = useCallback((index: number, character = 0) => {
    stop();
    const config = current.current;
    if (!config.doc?.segments[index]) return;
    const segments = config.doc.segments;
    const chunks = documentSpeechSource(config.doc, index, character), first = chunks.get(0);
    if (!first) return;
    if (preparation.current?.first !== first.text) preparation.current?.abort.abort();
    let activeChunk = first, lastPosition = -1, lastProgressAt = -Infinity, lastFraction = 0, shownFraction = 0, shownBuffer = 0, liveState: PlaybackState = 'idle';
    const progress = (fraction: number, force = false) => {
      lastFraction = fraction;
      const position = chunkPosition(activeChunk, fraction, segments);
      const changed = position.index !== lastPosition;
      if (changed) { lastPosition = position.index; current.current.onPosition(position.index); }
      const now = performance.now();
      // The audio clock and sentence cues stay at 40ms; only the estimated
      // timeline needs a slower UI update instead of repainting the whole app.
      if (mounted.current && (force || changed || fraction === 1 || now - lastProgressAt >= 200)) {
        lastProgressAt = now;
        if (position.fraction !== shownFraction) { shownFraction = position.fraction; setFraction(shownFraction); }
      }
    };
    const player = new BufferedNarrator({
      segments: chunks, request: { engine: 'local', voice: config.voice },
      speed: config.speed, startupSeconds: config.startupSeconds,
      createContext: output.current!.get, releaseContext: output.current!.release,
      onState: value => { liveState = value; if (mounted.current) { setState(value); if (value === 'playing') warmOutput(); if (value === 'idle') setSpoken(undefined); else if (value === 'paused') progress(lastFraction, true); } },
      onProgress: value => { if (liveState === 'idle' && value !== 1) { if (mounted.current) setFraction(value); } else progress(value); },
      onBuffer: value => { const seconds = Math.floor(value); if (mounted.current && seconds !== shownBuffer) { shownBuffer = seconds; setBufferedSeconds(seconds); } },
      onPosition: value => { activeChunk = chunks.get(value)!; if (mounted.current) setSpoken({ id: config.doc!.id, parts: activeChunk.parts }); progress(0); },
      onError: message => current.current.onError(message),
    });
    session.current = player;
    void player.start(0);
  }, [stop, warmOutput]);
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
  useEffect(() => { stop(); if (!doc) output.current?.close(); }, [doc?.id, voice, stop]);
  useEffect(() => {
    if (!doc || !voice || !prepareEnabled || !window.cadence) return;
    const abort = new AbortController();
    const chunks = documentSpeechPlan(doc, doc.position, 0, 3).slice(0, 3);
    preparation.current = { abort, first: chunks[0]?.text || '' };
    const timer = setTimeout(() => {
      // Prepare one silent output alongside the existing speech preparation.
      warmOutput();
      void (async () => {
        for (const chunk of chunks) {
          if (abort.signal.aborted) return;
          await synthesize({ text: chunk.text, engine: 'local', voice }, { signal: abort.signal, priority: 'background' });
        }
      })().catch(() => { /* Playback surfaces actionable errors; speculative work is silent. */ });
    }, 200);
    return () => { clearTimeout(timer); abort.abort(); };
    // Prepare on document/voice changes, never on each playback position update.
  }, [doc?.id, voice, prepareEnabled, warmOutput]);
  useEffect(() => { session.current?.setSpeed(speed); }, [speed]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; session.current?.stop(); output.current?.close(); }; }, []);
  const spokenParts = spoken?.id === doc?.id && (state === 'playing' || state === 'paused') ? spoken?.parts : undefined;
  return { state, fraction, bufferedSeconds, spokenParts, toggle, stop, jump, playFrom, seekSeconds };
}
