import type { Segment } from './types';

export interface SegmentSource<T extends Segment = Segment> {
  readonly length: number;
  get(index: number): T | undefined;
  release(before: number): void;
}

/** Pull only as far as the audio queue needs. Released text metadata cannot be
 * rewound; a new source-word start creates a new iterator instead. */
export class SegmentQueue<T extends Segment> implements SegmentSource<T> {
  private items = new Map<number, T>();
  private next = 0;
  private end = Infinity;
  get length() { return this.end; }
  get retained() { return this.items.size; }
  constructor(private iterator: Iterator<T>) {}
  get(index: number) {
    if (index < 0 || !Number.isInteger(index)) return undefined;
    while (this.next <= index && this.next < this.end) {
      const item = this.iterator.next();
      if (item.done) this.end = this.next;
      else this.items.set(this.next++, item.value);
    }
    return this.items.get(index);
  }
  release(before: number) { for (const index of this.items.keys()) if (index < before) this.items.delete(index); }
}
