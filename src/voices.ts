import type { Voice } from './types';
export const localVoices: Voice[] = [
  { id: 'af_heart', name: 'Heart', accent: 'American', gender: 'Female', description: 'Warm, expressive & effortlessly natural', color: 'rose' },
  { id: 'af_bella', name: 'Bella', accent: 'American', gender: 'Female', description: 'Bright, engaging & full of character', color: 'peach' },
  { id: 'af_nicole', name: 'Nicole', accent: 'American', gender: 'Female', description: 'Soft, intimate & unhurried', color: 'lavender' },
  { id: 'af_sarah', name: 'Sarah', accent: 'American', gender: 'Female', description: 'Clear, composed & conversational', color: 'sage' },
  { id: 'am_michael', name: 'Michael', accent: 'American', gender: 'Male', description: 'Grounded, rich & reassuring', color: 'blue' },
  { id: 'am_fenrir', name: 'Fenrir', accent: 'American', gender: 'Male', description: 'Confident, resonant & expressive', color: 'sand' },
  { id: 'bf_emma', name: 'Emma', accent: 'British', gender: 'Female', description: 'Elegant, gentle & beautifully measured', color: 'lavender' },
  { id: 'bm_george', name: 'George', accent: 'British', gender: 'Male', description: 'Warm, thoughtful & a born storyteller', color: 'sage' },
];

export const extendedVoices: Voice[] = [
  ['af_kore', 'Kore'], ['af_nova', 'Nova'], ['af_aoede', 'Aoede'], ['af_alloy', 'Alloy'], ['af_sky', 'Sky'],
  ['am_puck', 'Puck'], ['am_onyx', 'Onyx'], ['am_liam', 'Liam'], ['am_echo', 'Echo'],
  ['bf_isabella', 'Isabella'], ['bf_lily', 'Lily'], ['bf_alice', 'Alice'], ['bm_fable', 'Fable'], ['bm_daniel', 'Daniel'], ['bm_lewis', 'Lewis'],
].map(([id, name]) => ({ id, name, accent: id[0] === 'a' ? 'American' : 'British', gender: id[1] === 'f' ? 'Female' : 'Male', description: 'An additional local voice. Try a preview to find your favourite.', color: 'sage' }));
export const availableVoices = [...localVoices, ...extendedVoices];
export function blendVoice(primary: string, secondary: string, ratio: number): Voice | undefined {
  const first = availableVoices.find(voice => voice.id === primary), second = availableVoices.find(voice => voice.id === secondary);
  if (!first || !second || !Number.isInteger(ratio) || ratio < 0 || ratio > 100) return;
  return { id: `blend_${primary}_${secondary}_${ratio}`, name: `${first.name} + ${second.name}`, accent: ratio ? first.accent : second.accent, gender: '', description: `${ratio}% ${first.name} · ${100 - ratio}% ${second.name}. Experimental voice blend.`, color: first.color };
}
export function findVoice(id: string): Voice | undefined {
  const match = /^blend_([ab][fm]_[a-z]+)_([ab][fm]_[a-z]+)_(\d{1,3})$/.exec(id);
  return availableVoices.find(voice => voice.id === id) || (match ? blendVoice(match[1], match[2], Number(match[3])) : undefined);
}
