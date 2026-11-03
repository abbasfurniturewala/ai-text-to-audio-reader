import { build, Platform, Arch } from 'electron-builder';
import { readFile } from 'node:fs/promises';
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
await build({
  targets: Platform.WINDOWS.createTarget('dir', Arch.x64),
  config: { directories: { output: `release/staged-${pkg.version}` } },
});
