import type { DocumentTopic, Segment } from './types';
import { splitText } from './paragraphs';

interface Options { signal?: AbortSignal; inflate?: (bytes: Uint8Array) => Promise<Uint8Array> }
const maxEntry = 20 * 1024 * 1024, maxTotal = 128 * 1024 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true });
export function epubPath(base: string, href: string) {
  if (/^[a-z][\w+.-]*:|^[/\\]|\\|\0/i.test(href)) throw new Error('The EPUB contains an unsupported resource path.');
  const parts = base.split('/').slice(0, -1);
  for (const part of decodeURIComponent(href).split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!parts.length) throw new Error('The EPUB resource leaves its container.'); parts.pop(); }
    else { if (/[:\\\0]/.test(part)) throw new Error('Invalid EPUB resource path.'); parts.push(part); }
  }
  return parts.join('/');
}
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => { for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1; return value >>> 0; });
export function zipCrc(bytes: Uint8Array) { let crc = 0xffffffff; for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }

export function epubArchive(bytes: Uint8Array, options: Options = {}) {
  if (bytes.length > 50 * 1024 * 1024) throw new Error('Please choose an EPUB smaller than 50 MB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const check = (at: number, count: number) => { if (at < 0 || at + count > bytes.length) throw new Error('This EPUB archive is incomplete.'); };
  const u16 = (at: number) => { check(at, 2); return view.getUint16(at, true); };
  const u32 = (at: number) => { check(at, 4); return view.getUint32(at, true); };
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65557); end--) if (u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === bytes.length) break;
  if (end < Math.max(0, bytes.length - 65557)) throw new Error('This file is not a readable EPUB ZIP archive.');
  const count = u16(end + 10), size = u32(end + 12), directory = u32(end + 16);
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== count || count === 65535 || count > 10000 || directory === 0xffffffff || directory + size > end) throw new Error('This EPUB uses an unsupported or oversized ZIP container.');
  const entries = new Map<string, { method: number; packed: number; length: number; crc: number; offset: number }>();
  let at = directory, total = 0;
  for (let i = 0; i < count; i++) {
    check(at, 46);
    if (u32(at) !== 0x02014b50) throw new Error('The EPUB directory is damaged.');
    const flags = u16(at + 8), method = u16(at + 10), packed = u32(at + 20), length = u32(at + 24), nameLength = u16(at + 28), extra = u16(at + 30), comment = u16(at + 32), offset = u32(at + 42);
    check(at + 46, nameLength + extra + comment);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (flags & 1) throw new Error('This EPUB is encrypted. Choose a DRM-free EPUB.');
    if (u16(at + 34) || ![0, 8].includes(method) || length > maxEntry || packed > bytes.length || offset === 0xffffffff) throw new Error('This EPUB contains an unsupported or oversized entry.');
    total += length;
    if (total > maxTotal) throw new Error('This EPUB expands beyond the 128 MB import limit.');
    if (!name.endsWith('/')) {
      if (epubPath('', name) !== name || entries.has(name)) throw new Error('The EPUB contains duplicate or unsafe paths.');
      entries.set(name, { method, packed, length, crc: u32(at + 16), offset });
    }
    at += 46 + nameLength + extra + comment;
  }
  if (at !== directory + size) throw new Error('The EPUB directory size is invalid.');
  async function read(name: string) {
    options.signal?.throwIfAborted();
    const entry = entries.get(name);
    if (!entry) throw new Error(`The EPUB is missing a required resource: ${name}`);
    check(entry.offset, 30);
    if (u32(entry.offset) !== 0x04034b50 || u16(entry.offset + 6) & 1 || u16(entry.offset + 8) !== entry.method) throw new Error('The EPUB entry header is invalid.');
    const nameLength = u16(entry.offset + 26), extra = u16(entry.offset + 28), start = entry.offset + 30 + nameLength + extra;
    check(entry.offset + 30, nameLength + extra);
    if (decoder.decode(bytes.subarray(entry.offset + 30, entry.offset + 30 + nameLength)) !== name || start + entry.packed > directory) throw new Error('The EPUB entry is outside its data area.');
    const packed = bytes.subarray(start, start + entry.packed);
    let unpacked: Uint8Array;
    if (entry.method === 0) unpacked = packed;
    else if (options.inflate) unpacked = await options.inflate(packed);
    else {
      const source = new ReadableStream<BufferSource>({ start(controller) { controller.enqueue(new Uint8Array(packed)); controller.close(); } });
      const reader = source.pipeThrough(new DecompressionStream('deflate-raw')).getReader();
      const chunks: Uint8Array[] = []; let length = 0;
      const cancel = () => { void reader.cancel().catch(() => {}); };
      options.signal?.addEventListener('abort', cancel, { once: true });
      try {
        while (true) {
          options.signal?.throwIfAborted();
          const result = await reader.read();
          if (result.done) break;
          length += result.value.length;
          if (length > entry.length || length > maxEntry) { await reader.cancel(); throw new Error('The EPUB entry expands beyond its declared size.'); }
          chunks.push(result.value);
        }
        unpacked = new Uint8Array(length); let offset = 0;
        for (const chunk of chunks) { unpacked.set(chunk, offset); offset += chunk.length; }
      } finally { options.signal?.removeEventListener('abort', cancel); reader.releaseLock(); }
    }
    options.signal?.throwIfAborted();
    if (unpacked.length !== entry.length || zipCrc(unpacked) !== entry.crc) throw new Error('The EPUB resource failed its integrity check.');
    return unpacked;
  }
  return { has: (name: string) => entries.has(name), read, text: async (name: string) => {
    const data = await read(name);
    const encoding = (data[0] === 255 && data[1] === 254) || (data[0] === 60 && data[1] === 0) ? 'utf-16le' : (data[0] === 254 && data[1] === 255) || (data[0] === 0 && data[1] === 60) ? 'utf-16be' : 'utf-8';
    return new TextDecoder(encoding, { fatal: true }).decode(data).replace(/^\uFEFF/, '');
  } };
}

const name = (node: Element) => (node.localName || node.tagName.split(':').at(-1) || '').toLowerCase();
const children = (node: Node): Element[] => Array.from(node.childNodes).filter(child => child.nodeType === 1) as Element[];
const elements = (node: Document | Element, tag: string): Element[] => Array.from(node.getElementsByTagName('*')).filter(element => name(element) === tag);
function xml(text: string) {
  if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(text)) throw new Error('The EPUB contains unsupported XML entities.');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (!doc.documentElement || elements(doc, 'parsererror').length) throw new Error('The EPUB contains malformed XML or XHTML.');
  return doc;
}

export async function readEpub(bytes: Uint8Array, options: Options = {}) {
  const archive = epubArchive(bytes, options), segments: Segment[] = [], targets = new Map<string, number>();
  if ((await archive.text('mimetype')).trim() !== 'application/epub+zip') throw new Error('This archive is not an EPUB publication.');
  const container = xml(await archive.text('META-INF/container.xml'));
  const root = elements(container, 'rootfile')[0]?.getAttribute('full-path');
  if (!root) throw new Error('The EPUB has no package document.');
  const packagePath = epubPath('', root), opf = xml(await archive.text(packagePath));
  const manifest = new Map(elements(opf, 'item').map(item => [item.getAttribute('id') || '', item]));
  const spine = elements(opf, 'spine')[0];
  if (!spine) throw new Error('The EPUB has no reading order.');
  if (archive.has('META-INF/encryption.xml')) {
    const encrypted = xml(await archive.text('META-INF/encryption.xml'));
    for (const reference of elements(encrypted, 'cipherreference')) if (!/\.(?:otf|ttf|woff2?)(?:$|\?)/i.test(reference.getAttribute('URI') || '')) throw new Error('This EPUB contains encrypted content. Choose a DRM-free EPUB.');
  }
  const block = /^(?:h[1-6]|p|li|blockquote|pre|div|section|body|td|th|dt|dd)$/;
  const ignored = /^(?:script|style|head|nav|iframe|object)$/;
  for (const reference of children(spine)) {
    options.signal?.throwIfAborted();
    if (name(reference) !== 'itemref' || reference.getAttribute('linear') === 'no') continue;
    const item = manifest.get(reference.getAttribute('idref') || '');
    if (!item) throw new Error('The EPUB reading order references a missing chapter.');
    if (!/^(?:application\/xhtml\+xml|text\/html)$/.test(item.getAttribute('media-type') || '')) continue;
    const file = epubPath(packagePath, (item.getAttribute('href') || '').split('#')[0]);
    const chapter = xml(await archive.text(file));
    if (targets.has(file)) continue;
    targets.set(file, segments.length);
    const walk = (element: Element, depth = 0) => {
      if (depth > 128) throw new Error('The EPUB chapter is nested too deeply.');
      const tag = name(element);
      if (ignored.test(tag) || element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true') return;
      const id = element.getAttribute('id') || element.getAttribute('xml:id');
      if (id) targets.set(file + '#' + id, segments.length);
      if (!block.test(tag)) { for (const child of children(element)) walk(child, depth + 1); return; }
      let text = '';
      const level = /^h[1-6]$/.test(tag) ? Number(tag[1]) : undefined;
      const flush = () => { segments.push(...splitText(text).map(segment => ({ ...segment, heading: !!level, ...(level ? { headingLevel: level } : {}) }))); text = ''; };
      const collect = (node: Node, nested: number) => {
        if (nested > 128) throw new Error('The EPUB chapter is nested too deeply.');
        if (node.nodeType === 3 || node.nodeType === 4) { text += node.textContent || ''; return; }
        if (node.nodeType !== 1) return;
        const child = node as Element, childTag = name(child);
        if (ignored.test(childTag) || child.hasAttribute('hidden') || child.getAttribute('aria-hidden') === 'true') return;
        if (block.test(childTag)) { flush(); walk(child, nested + 1); }
        else {
          const anchor = child.getAttribute('id'); if (anchor) targets.set(file + '#' + anchor, segments.length);
          if (childTag === 'br') text += '\n';
          for (const part of Array.from(child.childNodes)) collect(part, nested + 1);
        }
      };
      for (const child of Array.from(element.childNodes)) collect(child, depth + 1);
      flush();
    };
    walk(elements(chapter, 'body')[0] || chapter.documentElement);
  }
  if (!segments.length) throw new Error('This EPUB has no readable text. Image-only books need OCR first.');
  const destination = (base: string, href: string) => {
    try { const [file, fragment] = href.split('#'); return targets.get((file ? epubPath(base, file) : base) + (fragment ? '#' + decodeURIComponent(fragment) : '')); }
    catch { return undefined; }
  };
  const topic = (title: string, at: number | undefined, nested: DocumentTopic[]): DocumentTopic[] => {
    const segment = at ?? nested[0]?.segment;
    if (segment === undefined || segment >= segments.length) return nested;
    return [{ title: title.trim() || segments[segment].text.slice(0, 100), page: 1, segment, ...(nested.length ? { children: nested } : {}) }];
  };
  let topics: DocumentTopic[] = [];
  const nav = [...manifest.values()].find(item => (item.getAttribute('properties') || '').split(/\s+/).includes('nav'));
  if (nav) {
    const file = epubPath(packagePath, nav.getAttribute('href') || ''), doc = xml(await archive.text(file));
    const toc = elements(doc, 'nav').find(element => (element.getAttribute('epub:type') || element.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || '').split(/\s+/).includes('toc'));
    const list = (element: Element, depth = 0): DocumentTopic[] => {
      if (depth > 64) throw new Error('The EPUB contents are nested too deeply.');
      return children(element).filter(child => name(child) === 'li').flatMap(li => {
        const label = children(li).find(child => name(child) === 'a' || name(child) === 'span');
        const nested = children(li).filter(child => name(child) === 'ol').flatMap(child => list(child, depth + 1));
        return topic(label?.textContent || '', label?.getAttribute('href') ? destination(file, label.getAttribute('href')!) : undefined, nested);
      });
    };
    if (toc) topics = children(toc).filter(child => name(child) === 'ol').flatMap(child => list(child));
  }
  if (!topics.length) {
    const ncx = manifest.get(spine.getAttribute('toc') || '') || [...manifest.values()].find(item => item.getAttribute('media-type') === 'application/x-dtbncx+xml');
    if (ncx) {
      const file = epubPath(packagePath, ncx.getAttribute('href') || ''), doc = xml(await archive.text(file));
      const points = (parent: Element, depth = 0): DocumentTopic[] => {
        if (depth > 64) throw new Error('The EPUB contents are nested too deeply.');
        return children(parent).filter(child => name(child) === 'navpoint').flatMap(point => topic(elements(point, 'navlabel')[0]?.textContent || '', destination(file, children(point).find(child => name(child) === 'content')?.getAttribute('src') || ''), points(point, depth + 1)));
      };
      const map = elements(doc, 'navmap')[0]; if (map) topics = points(map);
    }
  }
  return { title: elements(opf, 'title')[0]?.textContent?.trim() || '', segments, topics };
}
