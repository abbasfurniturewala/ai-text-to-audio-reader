/** At most one active clock plus one silent prepared clock. Retiring a context
 * releases SoundTouch processors that otherwise remain alive after disconnect. */
export class PlaybackContext {
  private active: AudioContext | undefined;
  private ready: AudioContext | undefined;
  constructor(private create = () => new AudioContext({ sampleRate: 24000 })) {}
  prepare() {
    if (!this.ready || this.ready.state === 'closed') {
      this.ready = this.create();
      void this.ready.suspend().catch(() => {});
    }
    return this.ready;
  }
  get = () => {
    if (!this.active || this.active.state === 'closed') {
      this.active = this.prepare(); this.ready = undefined;
    }
    return this.active;
  };
  release = (context: AudioContext) => {
    if (context === this.active) this.active = undefined;
    if (context.state !== 'closed') void context.close().catch(() => {});
  };
  close() {
    const active = this.active, ready = this.ready; this.active = this.ready = undefined;
    if (active) this.release(active);
    if (ready) this.release(ready);
  }
}
