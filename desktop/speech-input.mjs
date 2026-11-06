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
    .replace(/\b([a-zA-Z]{2,})-([ \t]*\n[ \t]*|[ \t]+)([a-z]{2,})\b/g, (_, left, gap, right) => {
      const compound = /^(?:well|long|short|self|high|low|part|full|half|real|one|two|three|state|of|the|non|cross|cost|time|user|customer)$/i.test(left);
      return left + (!compound && (gap.includes('\n') || /^(?:cation|tion|sion|ment|ness|ity|ation|ture|ance|ence)$/.test(right)) ? '' : '-') + right;
    })
    .replace(/(?<![.!?:;…—–\-\s])[ \t]*\n+\s*/g, '. ')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/\s*(?:→|->|=>|⟶|⇒)\s*/g, ', ')
    .replace(/₹\s*(\d+(?:,\d+)*(?:\.\d+)?(?:\s*(?:lakh|lakhs|crore|crores|thousand|million|billion))?)\b/gi, (_, amount) => `${amount} ${Number(amount.replace(/,/g, '')) === 1 ? 'rupee' : 'rupees'}`)
    .replace(/€\s*(\d+(?:,\d+)*(?:\.\d+)?(?:\s*(?:thousand|million|billion))?)\b/gi, (_, amount) => `${amount} ${Number(amount.replace(/,/g, '')) === 1 ? 'euro' : 'euros'}`)
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
function silence(samples, side) {
  let count = 0;
  while (count < samples.length && Math.abs(samples[side === 'start' ? count : samples.length - count - 1]) < .0005) count++;
  return count;
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
  const hasInternalPunct = /[,;:—–.!?]\s+\S/.test(rawText.trim());
  const inserts = [];
  if (hasInternalPunct) {
    let run = 0, valleyStart = first;
    const minBlocks = 20;
    for (let pos = first; pos < last; pos += block) {
      if (rmsAt(pos) < .0035) { if (!run) valleyStart = pos; run++; }
      else {
        if (run >= minBlocks) {
          const currentSec = (run * block) / rate;
          const addSec = currentSec < .46 ? Math.min(.09, .46 - currentSec) : 0;
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
  const blocks = text.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean);
  if (blocks.length > 1) {
    // Synthesize known source boundaries separately; a quiet valley does not locate a heading.
    let result = await generateComplete(tts, blocks[0], options, checkCancelled);
    for (let i = 1; i < blocks.length; i++) {
      checkCancelled();
      const next = await generateComplete(tts, blocks[i], options, checkCancelled);
      const left = trimPadding(result, 'end'), right = trimPadding(next, 'start');
      const pause = /[.!?…]["'”’\])]*$/.test(blocks[i - 1]) ? .64 : .74;
      const padding = Math.max(0, Math.round(result.sampling_rate * pause) - silence(left, 'end') - silence(right, 'start'));
      const audio = new Float32Array(left.length + padding + right.length);
      audio.set(left); audio.set(right, audio.length - right.length);
      result = { audio, sampling_rate: result.sampling_rate };
    }
    return result;
  }
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
