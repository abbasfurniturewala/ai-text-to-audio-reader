import { afterEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { inflateRawSync } from 'node:zlib';
import { epubArchive, epubPath, readEpub } from '../src/epub';
const options = { inflate: async (bytes: Uint8Array) => new Uint8Array(inflateRawSync(bytes)) };
afterEach(() => vi.unstubAllGlobals());
async function fixture(ncx = false) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OPS/book.opf" /></rootfiles></container>');
  zip.file('OPS/book.opf', `<package><metadata><title>A structured EPUB</title></metadata><manifest><item id="second" href="text/two.xhtml" media-type="application/xhtml+xml"/><item id="first" href="text/one.xhtml" media-type="application/xhtml+xml"/><item id="toc" href="${ncx ? 'toc.ncx' : 'nav.xhtml'}" media-type="${ncx ? 'application/x-dtbncx+xml' : 'application/xhtml+xml'}" properties="${ncx ? '' : 'nav'}"/></manifest><spine toc="toc"><itemref idref="first"/><itemref idref="second"/></spine></package>`);
  zip.file('OPS/text/one.xhtml', '<html><body><h1 id="start">First chapter</h1><p>Hello <em>reader</em>.</p><h2 id="detail">A detail</h2><blockquote><p>A nested quotation.</p></blockquote><ul><li><p>One item only.</p></li></ul><script>NEVER READ THIS</script></body></html>');
  zip.file('OPS/text/two.xhtml', '<html><body><h1 id="second">Second chapter</h1><p>Why did you leave?</p><p>The end.</p></body></html>');
  zip.file('OPS/nav.xhtml', '<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="text/one.xhtml#start">First</a><ol><li><a href="text/one.xhtml#detail">Detail</a></li></ol></li><li><a href="text/two.xhtml#second">Second</a></li></ol></nav></body></html>');
  zip.file('OPS/toc.ncx', '<ncx><navMap><navPoint><navLabel><text>First</text></navLabel><content src="text/one.xhtml#start"/><navPoint><navLabel><text>Detail</text></navLabel><content src="text/one.xhtml#detail"/></navPoint></navPoint><navPoint><navLabel><text>Second</text></navLabel><content src="text/two.xhtml#second"/></navPoint></navMap></ncx>');
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
describe('EPUB import', () => {
  it.each([false, true])('extracts spine order, nested blocks once and hierarchical nav/NCX (%s)', async ncx => {
    vi.stubGlobal('DOMParser', DOMParser);
    const book = await readEpub(await fixture(ncx), options);
    expect(book.title).toBe('A structured EPUB');
    expect(book.segments.map(segment => segment.text)).toEqual(['First chapter', 'Hello reader.', 'A detail', 'A nested quotation.', 'One item only.', 'Second chapter', 'Why did you leave?', 'The end.']);
    expect(book.segments[6].heading).toBe(false);
    expect(book.topics.map(topic => [topic.title, topic.segment])).toEqual([['First', 0], ['Second', 5]]);
    expect(book.topics[0].children?.[0]).toMatchObject({ title: 'Detail', segment: 2 });
  });
  it('rejects escaping resource paths, corrupt archives and excessive declared expansion', async () => {
    expect(epubPath('OPS/book.opf', 'text/../text/one.xhtml')).toBe('OPS/text/one.xhtml');
    expect(() => epubPath('OPS/book.opf', '../../outside')).toThrow();
    expect(() => epubPath('', 'https://example.org/chapter')).toThrow();
    expect(() => epubArchive(new Uint8Array(30))).toThrow();
    const bytes = await fixture(), view = new DataView(bytes.buffer);
    for (let at = 0; at < bytes.length - 46; at++) if (view.getUint32(at, true) === 0x02014b50) { view.setUint32(at + 24, 21 * 1024 * 1024, true); break; }
    expect(() => epubArchive(bytes)).toThrow('oversized');
  });
  it('honors cancellation before extracting a chapter', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(readEpub(await fixture(), { ...options, signal: controller.signal })).rejects.toThrow();
  });
  it('reads UTF-16 XHTML and table cells without losing paragraph semantics', async () => {
    vi.stubGlobal('DOMParser', DOMParser);
    const zip = await JSZip.loadAsync(await fixture());
    const text = '<html><body><h1 id="second">Second chapter</h1><table><tr><td>A table cell.</td></tr></table><p>Why did you leave?</p></body></html>';
    zip.file('OPS/text/two.xhtml', Buffer.concat([Buffer.from([255, 254]), Buffer.from(text, 'utf16le')]));
    const book = await readEpub(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), options);
    expect(book.segments.filter(segment => segment.text === 'A table cell.')).toHaveLength(1);
    expect(book.segments.at(-1)).toMatchObject({ text: 'Why did you leave?', heading: false });
  });
  it('checks CRC integrity instead of trusting ZIP metadata alone', async () => {
    const zip = new JSZip(); zip.file('plain.txt', 'A unique stored payload.');
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
    const at = Buffer.from(bytes).indexOf('A unique stored payload.'); bytes[at] ^= 1;
    await expect(epubArchive(bytes).read('plain.txt')).rejects.toThrow('integrity');
  });
});
