export interface Segment { text: string; page: number; heading?: boolean; headingLevel?: number }
export interface ReaderDocument {
  id: string; title: string; kind: 'PDF' | 'DOCX' | 'EPUB' | 'TXT' | 'NOTE';
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
export type ExportEngine = 'kokoro-cuda' | 'kokoro-cpu';
export interface ExportRequest {
  document: Pick<ReaderDocument, 'id' | 'title' | 'kind' | 'segments' | 'pageCount' | 'topics' | 'pageLabels'>;
  from: number; engine: ExportEngine; voice: string; voiceName: string;
}
export interface ExportJob {
  id: string; title: string; engine: string; voiceName: string; output: string; created: number;
  status: 'paused' | 'loading' | 'running' | 'encoding' | 'error' | 'complete'; message: string;
  progress: number; audioSeconds: number; chapterCount: number; estimatedWorkingBytes: number;
  completedCharacters?: number; totalCharacters?: number;
    encodedSamples?: number;
    finishing?: { phase: 'encoding' | 'assembling' | 'indexing' | 'checking' | 'saving'; startedAt: number; updatedAt: number; percent?: number; encodedSeconds?: number; totalSeconds?: number; remainingSeconds?: number };
}
export interface ExportRuntime { tools: boolean; kokoroGpu: boolean; capabilities: Record<string, unknown> }
export interface ExportSample { bytes: Uint8Array; loadMs: number; generationMs: number; audioSeconds: number; text: string; device: string }
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
  exportRuntime(): Promise<ExportRuntime>;
  exportJobs(): Promise<ExportJob[]>;
  createExport(request: ExportRequest): Promise<ExportJob | null>;
  controlExport(jobId: string, action: 'pause' | 'resume'): Promise<boolean>;
  exportSample(request: ExportRequest): Promise<ExportSample>;
  revealExport(jobId: string): Promise<void>;
  onExportProgress(listener: (message: { type: string; job?: ExportJob; error?: string }) => void): () => void;
  onModelProgress(listener: (progress: ModelProgress) => void): () => void;
}
declare global { interface Window { cadence?: DesktopBridge } }
