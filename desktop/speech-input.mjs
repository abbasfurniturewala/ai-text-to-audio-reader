/** Kokoro's default tokenizer truncates silently. Check the real phoneme token
 * count before inference instead, and only split if the model cannot fit it. */
export function guardTokenWindow(tts) {
  const tokenizer = tts.tokenizer;
  tts.tokenizer = (text, options) => {
    const encoded = tokenizer(text, { ...options, truncation: false });
    if (encoded.input_ids.dims.at(-1) > 512) {
      const error = new Error('This sentence exceeds the local voice context.');
      error.code = 'VOICE_CONTEXT';
      throw error;
    }
    return encoded;
  };
  return tts;
}

export function contextSplit(text) {
  const middle = text.length / 2;
  const clauses = [...text.matchAll(/[,;:—–]\s+/g)].map(match => match.index + 1)
    .filter(index => index >= text.length * .2 && index <= text.length * .8);
  const words = [...text.matchAll(/\s+/g)].map(match => match.index);
  const choices = clauses.length ? clauses : words;
  const at = choices.sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle))[0] || Math.floor(middle);
  return [text.slice(0, at).trim(), text.slice(at).trim()].filter(Boolean);
}

export function normalizeSpeechText(text) {
  const normalized = text
    .replace(/(?<![.!?:;…—–\-\s])[ \t]*\n+\s*/g, '. ')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/(?<=\b[a-zA-Z]{2,})-\s+(?=[a-z]{2,}\b)/g, '')
    .replace(/\s*(?:→|->|=>|⟶|⇒)\s*/g, ', ')
    .replace(/₹\s*(\d+(?:,\d+)*(?:\.\d+)?(?:\s*(?:lakh|lakhs|crore|crores|thousand|million|billion))?)\b/gi, '$1 rupees')
    .replace(/\b1 rupees\b/gi, '1 rupee')
    .replace(/€\s*(\d+(?:,\d+)*(?:\.\d+)?(?:\s*(?:thousand|million|billion))?)\b/gi, '$1 euros')
    .replace(/\b1 euros\b/gi, '1 euro')
    .replace(/(?<=\d)\s*–\s*(?=\d)/g, ' to ')
    .replace(/\s+–\s+/g, ' — ')
    .replace(/^[\s•●◦▪▸▹]+/u, '')
    .trim();
  return normalized && !/[.!?…,:;—–"'”’\])]$/u.test(normalized) ? normalized + '.' : normalized;
}

function trimPadding(audio, side) {
  const samples = audio.audio, margin = Math.round(audio.sampling_rate * .025);
  let at = side === 'start' ? 0 : samples.length - 1;
  const step = side === 'start' ? 1 : -1;
  while (at >= 0 && at < samples.length && Math.abs(samples[at]) < .0005) at += step;
  if (at < 0 || at >= samples.length) return samples;
  return side === 'start' ? samples.subarray(Math.max(0, at - margin)) : samples.subarray(0, Math.min(samples.length, at + margin + 1));
}

function paceAudio(audio, rawText) {
  const rate = audio?.sampling_rate, samples = audio?.audio;
  if (!rate || rate < 8000 || !samples || samples.length < rate * .25) return audio;
  const block = Math.max(1, Math.round(rate * .01));
  const rmsAt = start => {
    let sum = 0, end = Math.min(samples.length, start + block);
    for (let i = start; i < end; i++) sum += samples[i] * samples[i];
    return Math.sqrt(sum / Math.max(1, end - start));
  };
  let first = 0, last = samples.length;
  while (first < last && rmsAt(first) < .004) first += block;
  if (first >= last) return audio;
  while (last > first && rmsAt(Math.max(first, last - block)) < .004) last -= block;
  const hasHeadingBreak = /\n\s*\n/.test(rawText);
  const hasInternalPunct = hasHeadingBreak || /[,;:—–.!?]\s+\S/.test(rawText.trim());
  const inserts = [];
  if (hasInternalPunct) {
    let run = 0, valleyStart = first, usedHeadingBreak = false;
    const minBlocks = hasHeadingBreak ? 15 : 20;
    for (let pos = first; pos < last; pos += block) {
      if (rmsAt(pos) < .0035) { if (!run) valleyStart = pos; run++; }
      else {
        if (run >= minBlocks) {
          const currentSec = (run * block) / rate;
          const addSec = hasHeadingBreak && !usedHeadingBreak ? Math.max(0, .58 - currentSec)
            : (run >= 20 && currentSec < .46 ? Math.min(.09, .46 - currentSec) : 0);
          if (hasHeadingBreak && !usedHeadingBreak) usedHeadingBreak = true;
          if (addSec > .01) inserts.push({ at: valleyStart + Math.floor((run * block) / 2), count: Math.round(rate * addSec) });
        }
        run = 0;
      }
    }
  }
  const tailSilence = samples.length - last;
  const needTail = Math.max(0, Math.round(rate * .68) - tailSilence);
  if (!inserts.length && !needTail) return audio;
  const totalExtra = inserts.reduce((sum, item) => sum + item.count, 0) + needTail;
  const out = new Float32Array(samples.length + totalExtra);
  let src = 0, dst = 0;
  for (const item of inserts) {
    const slice = samples.subarray(src, item.at);
    out.set(slice, dst);
    dst += slice.length + item.count;
    src = item.at;
  }
  out.set(samples.subarray(src), dst);
  return { audio: out, sampling_rate: rate };
}

export async function generateComplete(tts, text, options, checkCancelled = () => {}) {
  checkCancelled();
  try { return paceAudio(await tts.generate(normalizeSpeechText(text), options), text); }
  catch (error) {
    if (error.code !== 'VOICE_CONTEXT' || text.length < 2) throw error;
    const pieces = contextSplit(text);
    if (pieces.length < 2) throw error;
    const first = await generateComplete(tts, pieces[0], options, checkCancelled);
    const second = await generateComplete(tts, pieces[1], options, checkCancelled);
    const left = trimPadding(first, 'end'), right = trimPadding(second, 'start');
    const audio = new Float32Array(left.length + right.length);
    audio.set(left); audio.set(right, left.length);
    return { audio, sampling_rate: first.sampling_rate };
  }
}
