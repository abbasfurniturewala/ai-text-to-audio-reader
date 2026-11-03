import { readFile, writeFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
const task = getDocument({ data: new Uint8Array(await readFile(process.argv[2])) });
try {
  const pdf = await task.promise;
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number), content = await page.getTextContent();
    const items = content.items.filter(item => 'str' in item);
    if (items.map(item => item.str).join(' ').includes('formal education')) {
      const result = { page: number, items: items.map(({ str, transform, width, height, fontName, hasEOL }) => ({ str, transform, width, height, fontName, hasEOL })) };
      await writeFile('test-results/paragraph-source.json', JSON.stringify(result, null, 2));
      console.log(JSON.stringify({ page: number, lines: items.filter(item => item.str.trim()).map(item => ({ text: item.str, x: item.transform[4], y: item.transform[5], height: item.height, font: item.fontName })) }, null, 2));
      break;
    }
    page.cleanup();
  }
} finally { await task.destroy(); }
