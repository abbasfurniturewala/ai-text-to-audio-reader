import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import mammoth from 'mammoth/mammoth.browser';
import type { ReaderDocument, Segment } from './types';
import { extractPdfStructure } from './topics';
import { NAVIGATION_VERSION, pdfPageHints, textTopics, type PdfPageHints } from './structure';
import { splitText, pdfParagraphs, TEXT_VERSION } from './paragraphs';
export { splitText } from './paragraphs';
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;
export { pdfjs };

export function makeDocument(title: string, text: string, kind: ReaderDocument['kind'] = 'NOTE'): ReaderDocument {
  return fromSegments(title, splitText(text), kind);
}
function fromSegments(title: string, segments: Segment[], kind: ReaderDocument['kind']): ReaderDocument {
  if (!segments.length) throw new Error('There is no readable text here. Add some text and try again.');
  const topics = textTopics(segments);
  return { id: crypto.randomUUID(), title: title.trim() || 'Untitled document', kind, created: Date.now(), updated: Date.now(), segments, position: 0, bookmarks: [], pageCount: 1, textVersion: TEXT_VERSION, topics, navigationVersion: NAVIGATION_VERSION, navigationSource: topics.length ? 'headings' : 'none' };
}

export async function importDocument(file: File, options: { signal?: AbortSignal; onProgress?: (page: number, total: number) => void } = {}): Promise<ReaderDocument> {
  const checkCancelled = () => options.signal?.throwIfAborted();
  checkCancelled();
  if (file.size > 50 * 1024 * 1024) throw new Error('Please choose a document smaller than 50 MB.');
  const extension = file.name.split('.').pop()?.toLowerCase();
  const title = file.name.replace(/\.[^.]+$/, '').replace(/[_]/g, ' ');
  if (extension === 'pdf') {
    const bytes = await file.arrayBuffer();
    checkCancelled();
    const task = pdfjs.getDocument({ data: bytes.slice(0) });
    const cancel = () => { void task.destroy(); };
    options.signal?.addEventListener('abort', cancel, { once: true });
    try {
      const pdf = await task.promise;
      const segments: Segment[] = [];
      const hasOutline = !!(await pdf.getOutline().catch(() => null))?.length;
      const hints: PdfPageHints[] = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        checkCancelled();
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        segments.push(...pdfParagraphs(content.items.filter(item => 'str' in item), pageNumber));
        if (!hasOutline) hints.push(pdfPageHints(content.items.filter(item => 'str' in item), pageNumber));
        page.cleanup();
        options.onProgress?.(pageNumber, pdf.numPages);
      }
      checkCancelled();
      if (!segments.length) throw new Error('This PDF has no selectable text. Scanned pages need OCR before they can be read aloud.');
      const pageLabels = await pdf.getPageLabels().catch(() => null) || [];
      const navigation = await extractPdfStructure(pdf, { segments, ...(hasOutline ? {} : { hints }), labels: pageLabels, signal: options.signal });
      checkCancelled();
      return { id: crypto.randomUUID(), title, kind: 'PDF', created: Date.now(), updated: Date.now(), segments, pageCount: pdf.numPages, position: 0, bookmarks: [], bytes, pageLabels, ...navigation, navigationVersion: NAVIGATION_VERSION, textVersion: TEXT_VERSION };
    } catch (error) { checkCancelled(); throw error; }
    finally { options.signal?.removeEventListener('abort', cancel); await task.destroy(); }
  }
  if (extension === 'docx') {
    const result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() }, { convertImage: mammoth.images.imgElement(async () => ({ src: '' })) });
    checkCancelled();
    const html = new DOMParser().parseFromString(result.value, 'text/html');
    const segments: Segment[] = [];
    for (const block of html.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,pre')) {
      const text = block.querySelector('h1,h2,h3,h4,h5,h6,p,li,pre') ? Array.from(block.childNodes).filter(node => !(node instanceof Element && (node.matches('h1,h2,h3,h4,h5,h6,p,li,pre') || node.querySelector('h1,h2,h3,h4,h5,h6,p,li,pre')))).map(node => node.textContent || '').join(' ') : block.textContent || '';
      const level = /^H[1-6]$/.test(block.tagName) ? Number(block.tagName[1]) : undefined;
      segments.push(...splitText(text).map(segment => ({ ...segment, heading: !!level, ...(level ? { headingLevel: level } : {}) })));
    }
    return fromSegments(title, segments, 'DOCX');
  }
  if (['txt', 'md'].includes(extension || '')) { const text = await file.text(); checkCancelled(); return makeDocument(title, text, 'TXT'); }
  throw new Error('Choose a PDF, DOCX, TXT or Markdown file. For older Word documents, save a copy as DOCX first.');
}

export async function readPdfNavigation(bytes: ArrayBuffer, signal?: AbortSignal, segments: Segment[] = []): Promise<Pick<ReaderDocument, 'pageLabels' | 'topics' | 'navigationVersion' | 'navigationSource'>> {
  signal?.throwIfAborted();
  const task = pdfjs.getDocument({ data: bytes });
  const cancel = () => { void task.destroy(); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const pdf = await task.promise;
    const pageLabels = await pdf.getPageLabels().catch(() => null) || [];
    const navigation = await extractPdfStructure(pdf, { segments, labels: pageLabels, signal });
    return { pageLabels, ...navigation, navigationVersion: NAVIGATION_VERSION };
  }
  finally { signal?.removeEventListener('abort', cancel); await task.destroy(); }
}
export function wordCount(doc: ReaderDocument) { return doc.segments.reduce((count, s) => count + (s.text.match(/\S+/g)?.length || 0), 0); }
export function durationLabel(words: number, speed = 1) { const minutes = Math.max(1, Math.ceil(words / (165 * speed))); return `${minutes} min`; }

export function welcomeDocument(): ReaderDocument {
  return { ...makeDocument('The art of paying attention', `THE LISTENING ROOM

The art of paying attention

There is a particular kind of quiet that arrives when you stop trying to do everything at once. The world does not become any less interesting. If anything, it becomes more so.

A cup of coffee cooling beside an open window. The sound of rain finding its way through the trees. A sentence in a book that makes you pause, then read it again. These small things have a way of bringing us back to ourselves.

Make room for a different rhythm

Reading has always been a conversation between a writer and a reader. Listening adds another dimension: a voice, a breath, a little space between the words. Ideas that once lived on a page begin to feel like company.

You do not have to finish a chapter to have a good reading day. You do not have to remember every word. Sometimes, the best thing a book can give you is a new way of noticing what is already there.

Let the words come to you

Take a walk. Settle into your favourite chair. Let your eyes rest. There is no right way to listen, only the way that fits into your life today.

Welcome to Cadence. Import a document or paste a passage, choose a voice that feels like good company, and press play. Your next good read can be a good listen, too.`), id: 'cadence-welcome', created: 1 };
}
