// Junction — audio playback (specs/assets.md "Audio", ASSETS.md §4).
//
// The city's sound is the PRODUCED .wav files (sfx-synth cues + a music bed), played
// through the Web Audio API — the cues on their events, and the ambient hum + music beds
// looped quietly under the city. Nothing autostarts before the first user gesture (browsers
// block autoplay); a mute toggle is provided (specs/controls.md). Mirrors valence's `Audio`.

import type { Cue } from "./types";

type Name = Cue | "hum" | "music";

// The looping beds and their steady-state gains (played once the graph resumes).
const BEDS: { name: Name; gain: number }[] = [
  { name: "hum", gain: 0.18 },
  { name: "music", gain: 0.3 },
];

const MASTER_GAIN = 0.6;

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<Name, AudioBuffer>();
  private bedSources = new Map<Name, AudioBufferSourceNode>();
  private started = false;
  private lastPlay = new Map<Name, number>(); // debounce identical cues in a frame
  muted = false;

  constructor(private readonly urls: Record<Name, string>) {}

  // Called on the first user gesture: build the graph, decode the clips, loop the beds.
  async resume(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === "suspended") await this.ctx.resume();
      if (!this.muted) this.startBeds();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = MASTER_GAIN;
    this.master.connect(this.ctx.destination);

    await Promise.all(
      (Object.keys(this.urls) as Name[]).map(async (name) => {
        const url = this.urls[name];
        if (!url) return;
        try {
          const res = await fetch(url);
          const raw = await res.arrayBuffer();
          const buf = await this.ctx!.decodeAudioData(raw);
          this.buffers.set(name, buf);
        } catch {
          // A missing/undecodable clip is non-fatal — that cue or bed is simply silent.
        }
      }),
    );
    this.started = true;
    if (!this.muted) this.startBeds();
  }

  private startBeds(): void {
    if (!this.ctx || !this.master) return;
    for (const bed of BEDS) {
      if (this.bedSources.has(bed.name)) continue;
      const buf = this.buffers.get(bed.name);
      if (!buf) continue;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const g = this.ctx.createGain();
      g.gain.value = bed.gain;
      src.connect(g).connect(this.master);
      src.start();
      this.bedSources.set(bed.name, src);
    }
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : MASTER_GAIN, this.ctx.currentTime, 0.02);
    }
    if (!this.muted && this.started) this.startBeds();
  }

  play(cue: Cue): void {
    if (!this.ctx || !this.master || this.muted) return;
    const buf = this.buffers.get(cue);
    if (!buf) return;
    const now = this.ctx.currentTime;
    // Debounce a flood of identical cues in the same instant (e.g. a drag laying a run).
    const last = this.lastPlay.get(cue) ?? -1;
    if (now - last < 0.03) return;
    this.lastPlay.set(cue, now);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = cue === "alert" ? 0.9 : 0.7;
    src.connect(g).connect(this.master);
    src.start();
  }
}
