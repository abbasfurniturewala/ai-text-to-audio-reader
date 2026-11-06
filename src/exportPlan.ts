import { documentSpeechSource } from './speechPlan';
import type { DocumentTopic, ReaderDocument } from './types';
export { speechClipBounds } from './narration';
export { pcm16, wavBytes } from './audio';

export type ExportDocument = Pick<ReaderDocument, 'id' | 'title' | 'kind' | 'segments' | 'pageCount' | 'topics' | 'pageLabels'>;
export interface ChapterTarget { title: string; segment: number; character: number }

export function exportSource(doc: ExportDocument, from = 0) {
  return documentSpeechSource(doc as ReaderDocument, from);
}
export function chapterTargets(doc: ExportDocument, from = 0): ChapterTarget[] {
  const targets: ChapterTarget[] = [];
  const visit = (items: DocumentTopic[], parent: string[]) => {
    for (const topic of items) {
      const title = [...parent, topic.title].join(' › ');
      const segment = topic.segment ?? doc.segments.findIndex(item => item.page >= topic.page);
      if (segment >= from && segment < doc.segments.length) targets.push({ title, segment, character: topic.character || 0 });
      if (topic.children) visit(topic.children, [...parent, topic.title]);
    }
  };
  if (doc.topics?.length) visit(doc.topics, []);
  else doc.segments.forEach((item, segment) => { if (segment >= from && item.heading) targets.push({ title: item.text, segment, character: 0 }); });
  return targets.sort((a, b) => a.segment - b.segment || a.character - b.character);
}
export function exportOffsets(doc: ExportDocument) {
  let total = 0;
  return doc.segments.map(item => { const start = total; total += item.text.length; return start; }).concat(total);
}
