import { readFile, writeFile, readdir, lstat, stat } from 'node:fs/promises';
import path from 'node:path';
import { sha256 } from './migrate-library.mjs';
const root = path.resolve(process.argv[2]);
const manifestPath = path.join(root, 'MIGRATION_BUNDLE.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (manifest.format !== 'cadence-project-migration') throw new Error('Not a migration bundle.');
const files = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (filename === manifestPath) continue;
    if ((await lstat(filename)).isSymbolicLink()) throw new Error('Redirected files are not included in migration bundles.');
    if (entry.isDirectory()) await walk(filename); else files.push(filename);
  }
}
await walk(root); manifest.files = [];
for (const filename of files.sort()) manifest.files.push({ path: path.relative(root, filename).split(path.sep).join('/'), size: (await stat(filename)).size, sha256: await sha256(filename) });
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ sealed: true, files: manifest.files.length, bytes: manifest.files.reduce((sum, file) => sum + file.size, 0) }));
