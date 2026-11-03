import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { withReader } from '../migration/migrate-library.mjs';
const project = path.resolve(process.argv[2] || process.cwd());
if (!process.argv[3]) throw new Error('Supply an explicit isolated --profile path as the second argument.');
const profile = path.resolve(process.argv[3]), fresh = process.argv.includes('--fresh');
const manifest = JSON.parse(await readFile(path.join(project, 'migration/library/library-manifest.json'), 'utf8'));
const settings = JSON.parse(await readFile(path.join(project, 'migration/library/settings.json'), 'utf8'));
const state = await withReader({ app: path.join(project, 'release/win-unpacked/Cadence.exe'), profile }, async evaluate => {
  const saved = await evaluate("(async()=>({status:await window.cadence.status(),items:(await __migrationGet('cadence-library-index-v2')).map(item=>({id:item.id,bookmarks:item.bookmarks,position:item.position})),session:JSON.parse(localStorage.getItem('cadence-reader-session-v1')||'{}'),location:document.querySelector('.viewing-location')?.dataset.location}))()");
  for (const record of manifest.documents) assert.ok(saved.items.some(item => item.id === record.id));
  if (fresh) {
    const sourceSession = JSON.parse(settings['cadence-reader-session-v1'] || '{}');
    assert.equal(saved.session.lastId, sourceSession.lastId);
    if (sourceSession.lastId) assert.equal(saved.session.books[sourceSession.lastId].page, sourceSession.books[sourceSession.lastId].page);
  }
  const audio = await evaluate("(async()=>{const result=await window.cadence.synthesize({text:'Your reader is ready, with natural offline narration.',voice:'af_heart',engine:'local',model:'eleven_multilingual_v2',priority:'interactive'});return {samples:result.samples?.length||0,sampleRate:result.sampleRate};})()");
  assert.equal(audio.sampleRate, 24000); assert.ok(audio.samples > 24000);
  return { appVersion: saved.status.version, documents: saved.items.length, lastBookRestored: fresh, samples: audio.samples, sampleRate: audio.sampleRate };
});
console.log(JSON.stringify({ verified: true, ...state }));
