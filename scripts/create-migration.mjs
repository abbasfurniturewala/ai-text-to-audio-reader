import { mkdir, cp, readdir, readFile, writeFile, stat, lstat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { sha256 } from '../migration/migrate-library.mjs';
const exec = promisify(execFile);
const root = process.cwd(), pkg = JSON.parse(await readFile('package.json', 'utf8'));
const bundleName = `Cadence-${pkg.version}-Migration-2026-11-01`;
const destination = path.join(root, 'release', 'migration', bundleName);
const library = path.resolve(process.argv[2] || 'test-results/migration-library-20261101');
if (await stat(destination).then(() => true, () => false)) throw new Error('Migration staging folder already exists; use a new bundle name or review it before replacing it.');
await mkdir(destination, { recursive: true });
for (const name of ['src', 'desktop', 'build', 'scripts', 'tests', 'migration']) await cp(path.join(root, name), path.join(destination, name), { recursive: true });
for (const name of ['.gitignore', 'README.md', 'AGENTS.md', 'START_HERE.md', 'CODEX_SETUP_PROMPT.txt', 'PROJECT_CONTEXT.md', 'MIGRATE-CADENCE.cmd', 'Start Cadence.cmd', 'package.json', 'package-lock.json', 'index.html', 'tsconfig.json', 'vite.config.ts', 'vitest.config.ts']) await cp(path.join(root, name), path.join(destination, name));
await cp(path.join(root, 'release', 'win-unpacked'), path.join(destination, 'release', 'win-unpacked'), { recursive: true });
await cp(library, path.join(destination, 'migration', 'library'), { recursive: true });
const nodeDirectory = path.dirname(process.execPath), nodeTarget = path.join(destination, 'tools', 'node');
await mkdir(nodeTarget, { recursive: true });
await cp(path.join(nodeDirectory, 'node.exe'), path.join(nodeTarget, 'node.exe'));
await writeFile(path.join(nodeTarget, 'npm.cmd'), '@echo off\r\n"%~dp0node.exe" "%~dp0node_modules\\npm\\bin\\npm-cli.js" %*\r\n');
await writeFile(path.join(nodeTarget, 'npx.cmd'), '@echo off\r\n"%~dp0node.exe" "%~dp0node_modules\\npm\\bin\\npx-cli.js" %*\r\n');
await cp(path.join(nodeDirectory, 'node_modules', 'npm'), path.join(nodeTarget, 'node_modules', 'npm'), { recursive: true });
await cp(path.join(root, 'migration', 'node-LICENSE.txt'), path.join(nodeTarget, 'LICENSE.txt'));
await writeFile(path.join(nodeTarget, 'RUNTIME_SOURCE.txt'), `Node.js ${process.version} win32-x64, copied from the source PC's existing Node installation.\nOfficial matching license: https://raw.githubusercontent.com/nodejs/node/v22.19.0/LICENSE\nnpm is supplied with its own LICENSE and locked project dependencies are installed with npm ci.\n`);
const manifest = { format: 'cadence-project-migration', schema: 1, bundleId: `${bundleName}-snapshot`, appVersion: pkg.version, platform: 'win32-x64', nodeVersion: process.version, documents: JSON.parse(await readFile(path.join(library, 'library-manifest.json'), 'utf8')).documents.length, files: [] };
const files = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if ((await lstat(filename)).isSymbolicLink()) throw new Error(`Migration does not copy redirected paths: ${filename}`);
    if (entry.isDirectory()) await walk(filename); else files.push(filename);
  }
}
await walk(destination);
for (const filename of files.sort()) manifest.files.push({ path: path.relative(destination, filename).split(path.sep).join('/'), size: (await stat(filename)).size, sha256: await sha256(filename) });
await writeFile(path.join(destination, 'MIGRATION_BUNDLE.json'), JSON.stringify(manifest, null, 2));
await writeFile('test-results/migration-staging.json', JSON.stringify({ destination, bundleName, files: files.length, bytes: manifest.files.reduce((sum, file) => sum + file.size, 0) }, null, 2));
console.log(JSON.stringify({ destination, files: files.length, bytes: manifest.files.reduce((sum, file) => sum + file.size, 0) }));
if (process.argv.includes('--zip')) {
  const result = await exec('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'migration', 'package.ps1'), '-Directory', destination], { windowsHide: true, maxBuffer: 1024 * 1024 });
  console.log(result.stdout.trim());
}
