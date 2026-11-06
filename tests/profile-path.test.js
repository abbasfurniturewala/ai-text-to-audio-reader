import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
const { profileDirectory } = createRequire(import.meta.url)('../desktop/profile-path.cjs');
describe('stable reader profile', () => {
  it('uses the same folder despite a host redirecting either AppData variable', () => {
    const home = path.resolve('test-results/fake-user');
    expect(profileDirectory(home, { APPDATA: 'normal', LOCALAPPDATA: 'normal' })).toBe(path.join(home, 'CadenceReaderData'));
    expect(profileDirectory(home, { APPDATA: 'packaged-private', LOCALAPPDATA: 'another-package' })).toBe(path.join(home, 'CadenceReaderData'));
  });
  it('keeps explicit QA and development profiles separate and refuses unsafe QA defaults', () => {
    const home = path.resolve('test-results/fake-user'), isolated = path.resolve('test-results/isolated');
    expect(profileDirectory(home, { CADENCE_QA: '1', CADENCE_DATA_DIR: isolated })).toBe(isolated);
    expect(() => profileDirectory(home, { CADENCE_QA: '1' })).toThrow(/isolated/);
  });
});
