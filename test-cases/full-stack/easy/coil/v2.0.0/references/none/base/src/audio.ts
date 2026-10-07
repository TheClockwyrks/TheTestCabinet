// Coil — the cue bus (specs/ui.md "Audio", specs/assets.md).
//
// The game stands on no engine, so the audio layer is the build's. It plays exactly
// the four produced cues, each decoded once from the file `specs/assets.md` names
// for it and played through a master gain the mute bit sets. A cue asked for while
// muted is still played and simply carries no gain, so muting is a volume rather
// than a branch and the game sounds the same the instant it is unmuted.
//
// Browsers refuse to start audio before the player has interacted with the page.
// The graph is therefore built and decoded at load, and `unlock()` resumes the
// context on the first key press. Every step is guarded: a context that cannot be
// created, a file that will not fetch, and a clip that will not decode each leave
// the game fully playable and silent.

import type { AudioBus } from "./game";
import type { Assets } from "./assets";
import { CUES, type Cue } from "./constants";

const CUE_GAIN = 0.7;
const MUSIC_GAIN = 0.34;

export class WebAudioBus implements AudioBus {
  muted = false;

  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private readonly buffers = new Map<Cue, AudioBuffer>();
  private loops = new Map<Cue, AudioBufferSourceNode>();

  /** Build the graph and decode every cue. Safe to call once, at load. */
  async load(assets: Assets): Promise<void> {
    try {
      const context = new AudioContext();
      const master = context.createGain();
      master.gain.value = this.muted ? 0 : 1;
      master.connect(context.destination);
      const musicBus = context.createGain();
      musicBus.gain.value = MUSIC_GAIN;
      musicBus.connect(master);
      this.context = context;
      this.master = master;
      this.musicBus = musicBus;
    } catch {
      return;
    }
    await Promise.all(
      (Object.values(CUES) as Cue[]).map((cue) =>
        this.decode(cue, assets.audio[cue]),
      ),
    );
  }

  /** Resume the context on the first user gesture, which browsers wait for. */
  unlock(): void {
    if (this.context && this.context.state === "suspended") {
      void this.context.resume().catch(() => undefined);
    }
  }

  play(cue: Cue): void {
    const source = this.source(cue, false);
    if (!source) return;
    source.start();
  }

  startLoop(cue: Cue): void {
    if (this.loops.has(cue)) return;
    const source = this.source(cue, true);
    if (!source) return;
    source.start();
    this.loops.set(cue, source);
  }

  stopLoop(cue: Cue): void {
    const source = this.loops.get(cue);
    if (!source) return;
    this.loops.delete(cue);
    try {
      source.stop();
    } catch {
      // A source that never started, or has already ended, needs no stopping.
    }
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 1;
  }

  private source(cue: Cue, loop: boolean): AudioBufferSourceNode | null {
    const context = this.context;
    const buffer = this.buffers.get(cue);
    if (!context || !buffer) return null;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    if (loop) {
      if (!this.musicBus) return null;
      source.connect(this.musicBus);
    } else {
      if (!this.master) return null;
      const gain = context.createGain();
      gain.gain.value = CUE_GAIN;
      source.connect(gain).connect(this.master);
    }
    return source;
  }

  private async decode(cue: Cue, url: string | null): Promise<void> {
    if (!this.context || url === null) return;
    try {
      const response = await fetch(url);
      const encoded = await response.arrayBuffer();
      this.buffers.set(cue, await this.context.decodeAudioData(encoded));
    } catch {
      // A cue whose file will not load or decode is simply silent.
    }
  }
}
