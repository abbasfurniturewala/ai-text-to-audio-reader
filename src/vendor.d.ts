declare module 'mammoth/mammoth.browser' {
  const mammoth: {
    extractRawText(options: { arrayBuffer: ArrayBuffer }): Promise<{ value: string; messages: unknown[] }>;
    convertToHtml(input: { arrayBuffer: ArrayBuffer }, options?: { convertImage?: unknown }): Promise<{ value: string; messages: unknown[] }>;
    images: { imgElement(convert: () => Promise<{ src: string }>): unknown };
  };
  export default mammoth;
}
