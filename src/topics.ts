import type { DocumentTopic, Segment } from './types';
import { attachTopicTargets, groupOpeningPages, pdfPageHints, structuralHeading, topicsFromPdfHints, type PdfPageHints } from './structure';

export interface OutlineNode { title: string; dest?: unknown; items?: OutlineNode[] }
export const isMainChapter = (title: string) => structuralHeading(title) || /^\d{1,3}(?!\d|\.\d)[.)\s:–—-]+\p{L}/u.test(title.trim());

/** Preserve the publisher's hierarchy, including bare "Chapter 1" headings. */
export function mainOutlineNodes(outline: OutlineNode[]): OutlineNode[] {
  let roots = outline;
  for (let depth = 0; depth < 8 && roots.length === 1 && roots[0].items?.length; depth++) {
    const root = roots[0];
    if (structuralHeading(root.title)) break;
    roots = root.items!;
  }
  return roots.slice(0, 500);
}

interface PdfStructure {
  numPages: number;
  getOutline(): Promise<OutlineNode[] | null>;
  getDestination(name: string): Promise<unknown[] | null>;
  getPageIndex(ref: { num: number; gen: number }): Promise<number>;
  getPage?(number: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }>; cleanup(): void }>;
}

export async function extractPdfStructure(pdf: PdfStructure, options: { segments?: Segment[]; hints?: PdfPageHints[]; labels?: string[]; signal?: AbortSignal } = {}) {
  options.signal?.throwIfAborted();
  const roots = await pdf.getOutline().catch(() => null);
  let budget = 2000;
  async function resolve(nodes: OutlineNode[], depth = 0): Promise<DocumentTopic[]> {
    if (depth > 8) return [];
    const result: DocumentTopic[] = [];
    for (const node of nodes.slice(0, depth ? 200 : 500)) {
      options.signal?.throwIfAborted();
      if (depth && budget-- <= 0) break;
      let page: number | undefined, y: number | undefined;
      try {
        const destination = typeof node.dest === 'string' ? await pdf.getDestination(node.dest) : node.dest;
        if (Array.isArray(destination)) {
          const ref = destination[0];
          const index = typeof ref === 'number' ? ref : ref && typeof ref.num === 'number' ? await pdf.getPageIndex(ref) : -1;
          if (index >= 0 && index < pdf.numPages) {
            page = index + 1;
            const mode = destination[1]?.name;
            const top = mode === 'XYZ' ? destination[3] : mode === 'FitH' || mode === 'FitBH' ? destination[2] : undefined;
            if (typeof top === 'number' && Number.isFinite(top)) y = top;
          }
        }
      } catch { /* Broken external destinations do not become guessed jumps. */ }
      const children = await resolve(node.items || [], depth + 1);
      page ??= children[0]?.page;
      const title = node.title.replace(/\s+/g, ' ').trim().slice(0, 300);
      if (!page || !title) { result.push(...children); continue; }
      if (children.length === 1 && children[0].page === page && /^(?:chapter|unit|lesson|module)\s+(?:\d+|[ivxlcdm]+)\s*$/i.test(title)) result.push({ ...children[0], title: `${title} — ${children[0].title}`, page, ...(y !== undefined ? { y } : {}) });
      else result.push({ title, page, ...(y !== undefined ? { y } : {}), ...(children.length ? { children } : {}) });
    }
    return result.sort((a, b) => a.page - b.page);
  }
  const outline = roots?.length ? await resolve(mainOutlineNodes(roots)) : [];
  if (outline.length) return { topics: attachTopicTargets(groupOpeningPages(outline), options.segments || []), navigationSource: 'outline' as const };
  let hints = options.hints;
  if (!hints && pdf.getPage) {
    hints = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      options.signal?.throwIfAborted();
      const page = await pdf.getPage(number);
      try {
        const content = await page.getTextContent();
        hints.push(pdfPageHints(content.items.filter((item: any) => 'str' in item) as Parameters<typeof pdfPageHints>[0], number));
      } finally { page.cleanup(); }
      if (number % 8 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  const inferred = topicsFromPdfHints(hints || [], options.segments || [], options.labels);
  return { topics: inferred.topics, navigationSource: inferred.source };
}

export async function extractPdfTopics(pdf: PdfStructure): Promise<DocumentTopic[]> { return (await extractPdfStructure(pdf)).topics; }
