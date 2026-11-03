export interface Segment { text: string; page: number; heading?: boolean; headingLevel?: number }
export interface ReaderDocument {
  id: string; title: string; kind: 'PDF' | 'DOCX' | 'TXT' | 'NOTE';
  created: number; updated: number; segments: Segment[]; pageCount: number;
  position: number; bookmarks: number[]; bytes?: ArrayBuffer;
  pageLabels?: string[];
  topics?: DocumentTopic[];
  navigationVersion?: number;
  navigationSource?: 'outline' | 'headings' | 'contents' | 'none';
  textVersion?: number;
}
export interface DocumentTopic {
  title: string; page: number; children?: DocumentTopic[];
  segment?: number; character?: number; y?: number;
}
/** The shelf keeps only small summaries. Text and original files live separately on disk. */
export interface LibraryItem extends Omit<ReaderDocument, 'segments' | 'bytes'> {
  wordCount: number;
  segmentCount: number;
  bookmarkPreviews: Record<number, Segment>;
}
export interface Voice { id: string; name: string; accent: string; gender: string; description: string; color?: string }
export type Engine = 'local';
export interface SpeechRequest { text: string; voice: string; engine?: Engine; model?: string }
export interface SpeechAudio { bytes: Uint8Array; mime: string; sampleRate: number; samples?: Float32Array }
export interface ModelProgress { status: string; file?: string; progress?: number; loaded?: number; total?: number }
export interface DesktopBridge {
  onBeforeClose(listener: () => Promise<void>): () => void;
  status(): Promise<{ desktop: boolean; modelReady: boolean; version: string }>;
  fullScreen(): Promise<boolean>;
  setFullScreen(enabled: boolean): Promise<boolean>;
  onFullScreen(listener: (enabled: boolean) => void): () => void;
  loadModel(): Promise<{ ready: boolean }>;
  synthesize(request: SpeechRequest & { requestId?: string; priority?: string }): Promise<SpeechAudio>;
  cancelSpeech(requestId: string): Promise<void>;
  saveAudio(bytes: Uint8Array, name: string): Promise<boolean>;
  onModelProgress(listener: (progress: ModelProgress) => void): () => void;
}
declare global { interface Window { cadence?: DesktopBridge } }
