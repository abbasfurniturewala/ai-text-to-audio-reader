import { wordSegments } from './textSegments';

interface Ranges { speech: Range[]; search: Range[] }
interface HoverRoot { x: number; y: number; until: number; timer?: ReturnType<typeof setTimeout> }
const owners = new Map<Element, Ranges>(), roots = new WeakMap<Element, HoverRoot>();
let pending = false, hover: { owner: HTMLElement; range: Range; start: number; end: number } | undefined;
export const nativeTextRanges = () => typeof Highlight !== 'undefined' && typeof CSS !== 'undefined' && !!CSS.highlights;

function publish() {
  if (pending || !nativeTextRanges()) return;
  pending = true;
  queueMicrotask(() => {
    pending = false;
    const speech: Range[] = [], search: Range[] = [];
    const ordered = [...owners].sort(([a], [b]) => a === b ? 0 : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    for (const [owner, ranges] of ordered) {
      if (!owner.isConnected) { owners.delete(owner); continue; }
      speech.push(...ranges.speech); search.push(...ranges.search);
    }
    const hovered = hover?.owner.isConnected && !speech.some(range => range.startContainer === hover!.range.startContainer && range.startOffset < hover!.range.endOffset && range.endOffset > hover!.range.startOffset) ? [hover.range] : [];
    for (const [name, ranges, priority] of [['speech', speech, 3], ['search', search, 4], ['hover', hovered, 2]] as const) {
      const key = `cadence-reading-${name}`;
      if (!ranges.length) CSS.highlights.delete(key);
      else { const highlight = new Highlight(...ranges); highlight.priority = priority; CSS.highlights.set(key, highlight); }
    }
  });
}
export function setReaderRanges(owner: Element, speech: Range[] = [], search: Range[] = []) {
  if (speech.length || search.length) owners.set(owner, { speech, search }); else owners.delete(owner);
  publish();
}
export function readerRange(element: Element, start: number, end: number) {
  if (start < 0 || end <= start) return;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), range = document.createRange();
  let offset = 0, began = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length || 0;
    if (!began && start <= offset + length) { range.setStart(node, Math.max(0, start - offset)); began = true; }
    if (began && end <= offset + length) { range.setEnd(node, Math.max(0, end - offset)); return range; }
    offset += length;
  }
}
export function readerWordAt(element: HTMLElement, text: string, x: number, y: number) {
  const source = element.querySelector<HTMLElement>('[data-reader-text]') || element;
  const caret = (document as Document & { caretRangeFromPoint(x: number, y: number): Range | null }).caretRangeFromPoint(x, y);
  if (!caret || !source.contains(caret.startContainer)) return;
  const prefix = document.createRange(); prefix.selectNodeContents(source); prefix.setEnd(caret.startContainer, caret.startOffset);
  const at = prefix.toString().length, segments = wordSegments(text);
  // A caret on the right half of a final glyph points after the word. Check
  // both adjacent segments against their real glyph rectangles, including RTL.
  for (const part of [segments.containing(at), segments.containing(at - 1)]) {
    if (!part?.isWordLike) continue;
    const start = part.index, end = start + part.segment.length, range = readerRange(source, start, end);
    if (range && [...range.getClientRects()].some(box => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom)) return { start, end, range, text: part.segment };
  }
}
export function clearReaderHover(owner?: Element) {
  if (!hover || owner && owner !== hover.owner && !owner.contains(hover.owner)) return;
  hover.owner.removeAttribute('title'); hover.owner.style.cursor = ''; hover = undefined; publish();
}
export function moveReaderHover(element: HTMLElement, text: string, x: number, y: number) {
  if (!nativeTextRanges()) return;
  if (window.getSelection()?.toString()) { clearReaderHover(); return; }
  const root = element.closest('.reader-scroll'), state = root && roots.get(root);
  if (state) { state.x = x; state.y = y; if (performance.now() < state.until) return; }
  const word = readerWordAt(element, text, x, y);
  if (!word) { clearReaderHover(); return; }
  if (hover?.owner === element && hover.start === word.start && hover.end === word.end) return;
  clearReaderHover(); hover = { owner: element, ...word };
  element.title = `Listen from “${word.text}”`; element.style.cursor = 'pointer'; publish();
}
export function bindReaderHover(root: Element) {
  const state: HoverRoot = { x: -1, y: -1, until: 0 }; roots.set(root, state);
  const move = (event: Event) => { const pointer = event as PointerEvent; state.x = pointer.clientX; state.y = pointer.clientY; };
  const leave = () => { state.x = state.y = -1; clearReaderHover(root); clearTimeout(state.timer); };
  const scroll = () => {
    state.until = performance.now() + 150; clearReaderHover(root); clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      const element = document.elementFromPoint(state.x, state.y)?.closest<HTMLButtonElement>('.passage');
      if (element && root.contains(element) && !element.disabled) moveReaderHover(element, element.querySelector('[data-reader-text]')?.textContent || element.textContent || '', state.x, state.y);
    }, 160);
  };
  root.addEventListener('pointermove', move, { passive: true }); root.addEventListener('pointerleave', leave); root.addEventListener('scroll', scroll, { passive: true });
  return () => { leave(); roots.delete(root); root.removeEventListener('pointermove', move); root.removeEventListener('pointerleave', leave); root.removeEventListener('scroll', scroll); };
}
