import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { exportLibrary, importLibrary, validateLibrary, withReader, within } from '../migration/migrate-library.mjs';
const input = path.resolve(process.argv[2] || 'test-results/migration-library-20261101');
const app = path.resolve(process.argv[3] || 'release/win-unpacked/Cadence.exe');
const testRoot = path.resolve(`test-results/migration-qa-${Date.now()}`);
await mkdir(testRoot, { recursive: true });
const profile = path.join(testRoot, 'profile'), checks = [];
async function check(name, run) { await run(); checks.push(name); console.log(`PASS ${name}`); }
const source = await validateLibrary(input);
await check('Backup schema, every original PDF, settings and document checksums validate', async () => { assert.equal(source.credentialsIncluded, false); assert.throws(() => within(input, '../outside.json')); });
await check('Portable import restores the saved library in a fresh isolated profile', async () => {
  const imported = await importLibrary({ app, profile, input });
  assert.equal(imported.imported + imported.keptExisting, source.documents.length);
  assert.equal(imported.freshDestination, true);
});
const roundTrip = path.join(testRoot, 'round-trip');
await check('Round-trip preserves IDs, text, bookmarks, audio positions, PDF bytes and browsing checkpoints', async () => {
  await exportLibrary({ app, profile, output: roundTrip });
  const after = await validateLibrary(roundTrip);
  assert.deepEqual(after.documents.map(record => record.id).sort(), source.documents.map(record => record.id).sort());
  for (const before of source.documents) {
    const restored = after.documents.find(record => record.id === before.id);
    const originalBook = JSON.parse(await readFile(within(input, before.documentFile), 'utf8'));
    const restoredBook = JSON.parse(await readFile(within(roundTrip, restored.documentFile), 'utf8'));
    assert.deepEqual(restoredBook.segments, originalBook.segments);
    assert.deepEqual(restoredBook.item.bookmarks, originalBook.item.bookmarks);
    assert.equal(restoredBook.item.position, originalBook.item.position);
    assert.equal(restored.pdfSha256, before.pdfSha256);
  }
  const beforeSettings = JSON.parse(await readFile(path.join(input, 'settings.json'), 'utf8'));
  const afterSettings = JSON.parse(await readFile(path.join(roundTrip, 'settings.json'), 'utf8'));
  const beforeSession = JSON.parse(beforeSettings['cadence-reader-session-v1'] || '{}');
  const afterSession = JSON.parse(afterSettings['cadence-reader-session-v1'] || '{}');
  assert.equal(afterSession.lastId, beforeSession.lastId);
  if (beforeSession.lastId) {
    assert.equal(afterSession.books[beforeSession.lastId].page, beforeSession.books[beforeSession.lastId].page);
    assert.equal(afterSession.books[beforeSession.lastId].original, beforeSession.books[beforeSession.lastId].original);
  }
  assert.ok(Object.keys(afterSettings).every(key => !/api|secret|token|password/i.test(key)));
});
await check('Re-import is idempotent and preserves newer destination state', async () => {
  await withReader({ app, profile }, async evaluate => {
    await evaluate("localStorage.setItem('cadence-speed', '1.25'); undefined");
    await evaluate("document.querySelector('[aria-label=\"Bookmark viewed passage\"],[aria-label=\"Remove bookmark\"]')?.click(); undefined");
    await new Promise(resolve => setTimeout(resolve, 100));
  });
  const before = await withReader({ app, profile }, evaluate => evaluate("(async()=>({items:await __migrationGet('cadence-library-index-v2')}))()"));
  const result = await importLibrary({ app, profile, input });
  assert.equal(result.imported, 0);
  const state = await withReader({ app, profile }, evaluate => evaluate("(async()=>({speed:localStorage.getItem('cadence-speed'),items:await __migrationGet('cadence-library-index-v2')}))()"));
  assert.equal(state.speed, '1.25');
  for (const item of before.items) assert.deepEqual(state.items.find(saved => saved.id === item.id).bookmarks, item.bookmarks);
  assert.equal(state.items.length, source.documents.length);
});
await writeFile('test-results/migration-results.json', JSON.stringify({ checks, documents: source.documents.length, testRoot }, null, 2));
