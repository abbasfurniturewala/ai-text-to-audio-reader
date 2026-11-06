import { readFile } from 'node:fs/promises';
import { Tensor } from '@huggingface/transformers';
import { generateComplete } from './speech-input.mjs';

export function parseBlend(voice, voices) {
  const match = /^blend_([ab][fm]_[a-z]+)_([ab][fm]_[a-z]+)_(\d{1,3})$/.exec(voice);
  if (!match || !Object.hasOwn(voices, match[1]) || !Object.hasOwn(voices, match[2]) || Number(match[3]) > 100) throw new Error('This voice blend is not supported.');
  return { primary: match[1], secondary: match[2], ratio: Number(match[3]) };
}
export function blendStyle(primary, secondary, ratio) {
  if (primary.length !== 256 || secondary.length !== 256 || !Number.isFinite(ratio) || ratio < 0 || ratio > 100) throw new Error('Invalid voice style.');
  const style = new Float32Array(256), weight = ratio / 100;
  for (let i = 0; i < style.length; i++) style[i] = primary[i] * weight + secondary[i] * (1 - weight);
  return style;
}
const styles = new Map();
async function voiceStyle(voice) {
  if (styles.has(voice)) { const style = styles.get(voice); styles.delete(voice); styles.set(voice, style); return style; }
  const bytes = await readFile(new URL(`../voices/${voice}.bin`, import.meta.resolve('kokoro-js')));
  const style = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  if (style.length !== 510 * 256) throw new Error('The bundled voice style is incomplete.');
  styles.set(voice, style);
  if (styles.size > 4) styles.delete(styles.keys().next().value);
  return style;
}
export async function generateVoice(tts, text, voice, checkCancelled) {
  if (Object.hasOwn(tts.voices, voice)) return generateComplete(tts, text, { voice, speed: 1 }, checkCancelled);
  const blend = parseBlend(voice, tts.voices);
  if (blend.ratio === 0 || blend.ratio === 100) return generateComplete(tts, text, { voice: blend.ratio ? blend.primary : blend.secondary, speed: 1 }, checkCancelled);
  const secondary = await voiceStyle(blend.secondary), model = tts.model;
  // The worker serializes inference, so this override cannot affect another request.
  tts.model = inputs => {
    const offset = 256 * Math.min(Math.max(inputs.input_ids.dims.at(-1) - 2, 0), 509);
    return model({ ...inputs, style: new Tensor('float32', blendStyle(inputs.style.data, secondary.subarray(offset, offset + 256), blend.ratio), [1, 256]) });
  };
  try { return await generateComplete(tts, text, { voice: blend.primary, speed: 1 }, checkCancelled); }
  finally { tts.model = model; }
}
