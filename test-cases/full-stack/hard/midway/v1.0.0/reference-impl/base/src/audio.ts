// Midway — audio playback (specs/assets.md "Audio"; ASSETS.md §4).
//
// The park's sound is the PRODUCED .wav files (all SFX from sfx-synth; the music bed from
// music with synth-waveform tracks — see ASSETS.md's environment note), played through
// the Web Audio API: the event cues (coin/ding/alarm) on their events, and the crowd hum
// + carnival music looped under the park. Nothing autostarts before the first user
// gesture (browsers block autoplay); a mute toggle is provided (specs/controls.md).

import type { Cue } from "./types";

// The two looping beds vs the one-shot event cues.
const BEDS: Cue[] = ["crowd", "music"];
const isBed = (c: Cue): boolean => BEDS.includes(c);

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bedGain: GainNode | null = null;
  private buffers = new Map<Cue, AudioBuffer>();
  private bedSources = new Map<Cue, AudioBufferSourceNode>();
  private started = false;
  private lastPlay = new Map<Cue, number>(); // debounce identical cues in an instant
  muted = false;

  constructor(private readonly urls: Record<Cue, string>) {}

  // Called on the first user gesture: build the graph, decode the clips, loop the beds.
  async resume(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === "suspended") await this.ctx.resume();
      if (!this.muted) this.startBeds();
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
    this.bedGain = this.ctx.createGain();
    this.bedGain.gain.value = 0.3;
    this.bedGain.connect(this.master);

    await Promise.all(
      (Object.keys(this.urls) as Cue[]).map(async (name) => {
        const url = this.urls[name];
        if (!url) return;
        try {
          const res = await fetch(url);
          const raw = await res.arrayBuffer();
          const buf = await this.ctx!.decodeAudioData(raw);
          this.buffers.set(name, buf);
        } catch {
          // A missing/undecodable clip is non-fatal — that cue is simply silent.
        }
      }),
    );
    this.started = true;
    if (!this.muted) this.startBeds();
  }

  private startBeds(): void {
    if (!this.ctx || !this.bedGain) return;
    for (const bed of BEDS) {
      if (this.bedSources.has(bed)) continue;
      const buf = this.buffers.get(bed);
      if (!buf) continue;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(this.bedGain);
      src.start();
      this.bedSources.set(bed, src);
    }
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.6, this.ctx.currentTime, 0.02);
    }
    if (!this.muted && this.started) this.startBeds();
  }

  // Play a one-shot event cue (the loop beds are ignored — they run continuously).
  play(cue: Cue): void {
    if (!this.ctx || !this.master || this.muted || isBed(cue)) return;
    const buf = this.buffers.get(cue);
    if (!buf) return;
    const now = this.ctx.currentTime;
    const last = this.lastPlay.get(cue) ?? -1;
    if (now - last < 0.03) return; // debounce a flood of identical cues in one instant
    this.lastPlay.set(cue, now);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = cue === "alarm" ? 0.9 : 0.7;
    src.connect(g).connect(this.master);
    src.start();
  }
}
