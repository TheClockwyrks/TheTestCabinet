// Arc Foundry — audio playback (specs/assets.md "Audio").
//
// The yard's sound is the PRODUCED .wav files (sfx-synth / sfx-sample / music), played
// through the Web Audio API — the cues on their events and the industrial-electro reactor
// bed looped under the board. Nothing autostarts before the first user gesture (browsers
// block autoplay); a mute toggle is provided (specs/controls.md).

import type { Cue } from "./types";

type Name = Cue | "music";

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private buffers = new Map<Name, AudioBuffer>();
  private musicSource: AudioBufferSourceNode | null = null;
  private started = false;
  private lastPlay = new Map<Name, number>(); // debounce identical cues in a frame
  muted = false;

  constructor(private readonly urls: Record<Name, string>) {}

  // Called on the first user gesture: build the graph, decode the clips, loop music.
  async resume(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === "suspended") await this.ctx.resume();
      if (!this.musicSource && !this.muted) this.startMusic();
      return;
    }
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.32;
    this.musicGain.connect(this.master);

    await Promise.all(
      (Object.keys(this.urls) as Name[]).map(async (name) => {
        try {
          const res = await fetch(this.urls[name]);
          const raw = await res.arrayBuffer();
          const buf = await this.ctx!.decodeAudioData(raw);
          this.buffers.set(name, buf);
        } catch {
          // A missing/undecodable clip is non-fatal — that cue is simply silent.
        }
      }),
    );
    this.started = true;
    if (!this.muted) this.startMusic();
  }

  private startMusic(): void {
    if (!this.ctx || !this.musicGain) return;
    const buf = this.buffers.get("music");
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.musicGain);
    src.start();
    this.musicSource = src;
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.6, this.ctx.currentTime, 0.02);
    }
    if (!this.muted && this.started && !this.musicSource) this.startMusic();
  }

  play(cue: Cue): void {
    if (!this.ctx || !this.master || this.muted) return;
    const buf = this.buffers.get(cue);
    if (!buf) return;
    const now = this.ctx.currentTime;
    // Debounce a flood of identical cues in the same instant (e.g. many shots a tick).
    const last = this.lastPlay.get(cue) ?? -1;
    if (now - last < 0.03) return;
    this.lastPlay.set(cue, now);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = cue === "leak" ? 0.9 : 0.7;
    src.connect(g).connect(this.master);
    src.start();
  }
}
