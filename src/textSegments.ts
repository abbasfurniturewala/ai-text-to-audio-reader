const words = new Intl.Segmenter(undefined, { granularity: 'word' });
const sentences = new Intl.Segmenter('en', { granularity: 'sentence' });

export const wordSegments = (text: string) => words.segment(text);
export const sentenceSegments = (text: string) => sentences.segment(text);
