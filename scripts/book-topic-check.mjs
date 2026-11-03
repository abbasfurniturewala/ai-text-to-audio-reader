import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
await mkdir('test-results', { recursive: true });
const bundled = await build({ entryPoints: ['src/topics.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
await writeFile('test-results/topics-runtime.mjs', bundled.outputFiles[0].text);
const { extractPdfStructure } = await import('../test-results/topics-runtime.mjs');
for (const filename of process.argv.slice(2)) {
  const task = getDocument({ data: new Uint8Array(await readFile(filename)) });
  try {
    const pdf = await task.promise;
    const result = await extractPdfStructure(pdf, { labels: await pdf.getPageLabels() || [] });
    const topics = result.topics;
    if (/Poor Charlie/i.test(filename)) {
      const chapters = topics.filter(topic => /^Chapter/i.test(topic.title));
      assert.deepEqual(chapters.map(topic => topic.page), [7, 60, 91, 148]);
      assert.equal(chapters[3].children.length, 11);
      assert.equal(topics[0].title, 'Opening pages');
      assert.equal(chapters[0].children[0].page, 8);
    }
    if (/varian/i.test(filename)) {
      assert.ok(topics.some(topic => /1\s+The Market/.test(topic.title)));
      assert.ok(topics.some(topic => /2\s+Budget Constraint/.test(topic.title)));
      assert.ok(topics.length >= 35);
    }
    const summary = { file: filename, pages: pdf.numPages, source: result.navigationSource, roots: topics.map(topic => ({ title: topic.title, page: topic.page, sections: topic.children?.length || 0 })) };
    await writeFile(`test-results/book-navigation-${pdf.numPages}.json`, JSON.stringify({ ...summary, topics }, null, 2));
    console.log(JSON.stringify(summary));
  } finally { await task.destroy(); }
}
