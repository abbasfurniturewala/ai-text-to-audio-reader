import { describe, expect, it, vi } from 'vitest';
import { PlaybackContext } from '../src/playbackContext';

function clock() {
  const value = { state: 'suspended', suspend: vi.fn(async () => {}), close: vi.fn(async () => { value.state = 'closed'; }) };
  return value;
}
describe('reader output clock lifetime', () => {
  it('prepares only one silent standby and closes each retired active context', () => {
    const first = clock(), next = clock(), create = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(next), pool = new PlaybackContext(create);
    expect(pool.prepare()).toBe(first); expect(pool.prepare()).toBe(first); expect(create).toHaveBeenCalledTimes(1);
    expect(pool.get()).toBe(first); expect(pool.prepare()).toBe(next); expect(pool.prepare()).toBe(next);
    pool.release(first as unknown as AudioContext); expect(first.close).toHaveBeenCalledTimes(1);
    expect(pool.get()).toBe(next); expect(create).toHaveBeenCalledTimes(2);
    pool.close(); expect(next.close).toHaveBeenCalledTimes(1);
  });
  it('does not close a replacement when an obsolete session releases its old context', () => {
    const first = clock(), next = clock(), create = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(next), pool = new PlaybackContext(create);
    const old = pool.get(); pool.release(old); pool.get(); pool.release(old);
    expect(next.close).not.toHaveBeenCalled(); pool.close(); expect(next.close).toHaveBeenCalledTimes(1);
  });
  it('closes both clocks when the reader closes and can prepare again afterwards', () => {
    const first = clock(), next = clock(), later = clock(), create = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(next).mockReturnValueOnce(later), pool = new PlaybackContext(create);
    pool.get(); pool.prepare(); pool.close(); expect(first.close).toHaveBeenCalledTimes(1); expect(next.close).toHaveBeenCalledTimes(1);
    expect(pool.prepare()).toBe(later); pool.close(); expect(later.close).toHaveBeenCalledTimes(1);
  });
});
