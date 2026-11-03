import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, within, validateLibrary } from './migrate-library.mjs';
const root = path.resolve(process.argv[2] || fileURLToPath(new URL('..', import.meta.url)));
const manifest = JSON.parse(await readFile(path.join(root, 'MIGRATION_BUNDLE.json'), 'utf8'));
if (manifest.format !== 'cadence-project-migration' || manifest.schema !== 1) throw new Error('Unsupported migration bundle.');
for (const record of manifest.files) {
  const filename = within(root, record.path);
  if ((await stat(filename)).size !== record.size || await sha256(filename) !== record.sha256) throw new Error(`File is incomplete or changed: ${record.path}`);
}
await validateLibrary(path.join(root, 'migration', 'library'));
console.log(JSON.stringify({ verified: true, appVersion: manifest.appVersion, files: manifest.files.length, documents: manifest.documents, bundleId: manifest.bundleId }));
