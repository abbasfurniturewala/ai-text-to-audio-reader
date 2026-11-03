import { readFile, writeFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
const task = getDocument({ data: new Uint8Array(await readFile(process.argv[2])) });
try {
  const pdf = await task.promise;
  const outline = await pdf.getOutline();
  async function resolve(nodes) {
    return Promise.all((nodes || []).map(async node => {
      let page;
      try { const dest = typeof node.dest === 'string' ? await pdf.getDestination(node.dest) : node.dest; if (dest) page = (typeof dest[0] === 'number' ? dest[0] : await pdf.getPageIndex(dest[0])) + 1; } catch {}
      return { title: node.title, page, children: await resolve(node.items) };
    }));
  }
  const result = { pageCount: pdf.numPages, outline: await resolve(outline), sample: [] };
  for (const number of [1, 2, 3, 4, 5, 6, 10, 150]) {
    if (number > pdf.numPages) continue;
    const page = await pdf.getPage(number), content = await page.getTextContent();
    result.sample.push({ page: number, items: content.items.filter(item => 'str' in item && item.str.trim()).map(item => ({ text: item.str, x: item.transform[4], y: item.transform[5], height: item.height })) });
    page.cleanup();
  }
  await writeFile('test-results/navigation-inspection.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ pageCount: pdf.numPages, outline: result.outline, sample: result.sample.map(page => ({ page: page.page, text: page.items.slice(0, 18).map(item => item.text) })) }, null, 2));
} finally { await task.destroy(); }
