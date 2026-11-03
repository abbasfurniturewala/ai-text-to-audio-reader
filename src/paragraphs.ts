import type { Segment } from './types';

export const TEXT_VERSION = 2;
export const endsSentence = (text: string) => /[.!?…]["'”’\])]*$/.test(text.trim());
const isHeading = (text: string) => text.length < 95 && text.split(/\s+/).length <= 10 && !/[.!?;:,]$/.test(text);

/** Display paragraphs are independent of the voice model's input window. */
export function splitText(text: string, page = 1): Segment[] {
  return text.replace(/\r\n?/g, '\n').replace(/\u0000/g, '').split(/\n\s*\n/)
    .map(paragraph => paragraph.replace(/\s+/g, ' ').trim()).filter(Boolean)
    .map(text => ({ text, page, heading: isHeading(text) }));
}

interface PdfTextItem { str: string; transform: number[]; width: number; height: number; hasEOL?: boolean }
interface Line { text: string; x: number; right: number; y: number; height: number }

/** Use the page's actual baseline pitch. Font height * 1.6 used to place
 * identical 24pt lines on opposite sides of a floating-point threshold. */
export function pdfParagraphs(items: PdfTextItem[], page: number): Segment[] {
  const lines: Line[] = [];
  for (const item of items) {
    if (!item.str.trim()) continue;
    const x = item.transform[4], y = item.transform[5], height = Math.abs(item.height) || 12;
    const previous = lines.at(-1);
    if (previous && Math.abs(y - previous.y) <= Math.max(2, height * .2) && x >= previous.x - 2) {
      previous.text += ' ' + item.str;
      previous.right = Math.max(previous.right, x + item.width);
      previous.height = Math.max(previous.height, height);
    } else lines.push({ text: item.str, x, right: x + item.width, y, height });
  }
  if (!lines.length) return [];
  const pitches = lines.slice(1).map((line, index) => lines[index].y - line.y)
    .filter((gap, index) => gap > lines[index].height * .6 && gap < lines[index].height * 2.5).sort((a, b) => a - b);
  const pitch = pitches.length ? pitches[Math.floor((pitches.length - 1) * .4)] : 0;
  const right = Math.max(...lines.map(line => line.right));
  const paragraphs: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index], previous = lines[index - 1];
    const gap = previous ? previous.y - line.y : 0;
    const spacingBreak = previous && gap > (pitch ? pitch * 1.4 : previous.height * 2.2) + 1;
    const columnBreak = previous && (gap < -2 || line.x > previous.right + line.height);
    const fontBreak = previous && Math.abs(line.height - previous.height) > Math.min(line.height, previous.height) * .25;
    const paragraphEnd = previous && endsSentence(previous.text) &&
      (previous.right < right - previous.height * 3 || line.x > previous.x + line.height * .7);
    if (!previous || spacingBreak || columnBreak || fontBreak || paragraphEnd) paragraphs.push(line.text);
    else paragraphs[paragraphs.length - 1] += ' ' + line.text;
  }
  return paragraphs.flatMap(text => splitText(text, page));
}

/** Older libraries have no original DOCX/TXT layout. Conservatively repair
 * unfinished sentences on the same page; keep complete sentences and headings. */
export function repairLegacyParagraphs(segments: Segment[]) {
  const repaired: Segment[] = [], indexMap: number[] = [];
  for (const segment of segments) {
    const previous = repaired.at(-1);
    const heading = segment.heading && isHeading(segment.text) && !/^[a-z]/.test(segment.text);
    const previousHeading = previous?.heading && isHeading(previous.text) && !/^[a-z]/.test(previous.text);
    if (previous && previous.page === segment.page && !endsSentence(previous.text) && !previousHeading && !heading) {
      previous.text += ' ' + segment.text;
      previous.heading = false;
    } else repaired.push({ ...segment });
    indexMap.push(repaired.length - 1);
  }
  return { segments: repaired, indexMap };
}
