// Hollowdeep — audio playback (ASSETS.md "Audio", specs/assets.md).
//
// The colony's sound is the PRODUCED .wav files (sfx-synth for the cues, music for the
// bed), played through the Web Audio API — the one-shot cues on their events (dig/build/
// alarm), the machine hum LOOPED under any running machine, and the ambient bed looped
// under everything. Nothing autostarts before the first user gesture (browsers block
// autoplay); a mute toggle is provided (specs/controls.md). Structure copied from valence
// audio.ts, extended with the looping machine hum.

import type { Cue } from "./types";

type Name = Cue | "music";

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private humGain: GainNode | null = null;
  private buffers = new Map<Name, AudioBuffer>();
  private musicSource: AudioBufferSourceNode | null = null;
  private humSource: AudioBufferSourceNode | null = null;
  private started = false;
  private humActive = false; // a machine is running → the hum should loop
  private lastPlay = new Map<Name, number>(); // debounce identical cues in a frame
  muted = false;

  constructor(private readonly urls: Record<Name, string>) {}

  // Called on the first user gesture: build the graph, decode the clips, loop the bed
  // (and the machine hum if a machine is already running).
  async resume(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === "suspended") await this.ctx.resume();
      if (!this.muted) {
        if (!this.musicSource) this.startMusic();
        if (this.humActive && !this.humSource) this.startHum();
      }
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
    this.musicGain.gain.value = 0.3;
    this.musicGain.connect(this.master);
    this.humGain = this.ctx.createGain();
    this.humGain.gain.value = 0; // faded in when a machine runs
    this.humGain.connect(this.master);

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
    if (!this.muted) {
      this.startMusic();
      if (this.humActive) this.startHum();
    }
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

  private startHum(): void {
    if (!this.ctx || !this.humGain) return;
    const buf = this.buffers.get("machine");
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.humGain);
    src.start();
    this.humSource = src;
  }

  // Fade the looping machine hum in when at least one machine is running, out when none
  // are. The loop source keeps playing; only its level changes (seamless).
  setMachineHum(active: boolean): void {
    this.humActive = active;
    if (!this.ctx || !this.humGain) return;
    if (active && !this.humSource && this.started && !this.muted) this.startHum();
    const target = active && !this.muted ? 0.28 : 0;
    this.humGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.15);
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.6, this.ctx.currentTime, 0.02);
    }
    if (!this.muted && this.started) {
      if (!this.musicSource) this.startMusic();
      if (this.humActive && !this.humSource) this.startHum();
    }
  }

  play(cue: Cue): void {
    // The machine cue is a continuous loop, driven by setMachineHum — not a one-shot.
    if (cue === "machine") return;
    if (!this.ctx || !this.master || this.muted) return;
    const buf = this.buffers.get(cue);
    if (!buf) return;
    const now = this.ctx.currentTime;
    // Debounce a flood of identical cues in the same instant (e.g. many tiles mined a tick).
    const last = this.lastPlay.get(cue) ?? -1;
    if (now - last < 0.03) return;
    this.lastPlay.set(cue, now);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = cue === "alarm" ? 0.9 : 0.7;
    src.connect(g).connect(this.master);
    src.start();
  }
}
