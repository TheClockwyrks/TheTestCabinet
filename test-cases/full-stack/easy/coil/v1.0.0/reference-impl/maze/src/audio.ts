// Coil — audio playback (specs/flow.md "Audio", specs/assets.md).
//
// The game's sound is the PRODUCED .wav files (sfx-synth for the eat/combo/death cues,
// music for the looping bed), played through the Web Audio API: the one-shot cues fire on
// their events and the bed loops under the round. Nothing autostarts before the first user
// gesture (browsers block autoplay) — the graph is built and the clips decoded on `resume`,
// which the loop calls on the first input. A mute toggle is provided (persisted to
// `coil.muted`), and every step is guarded so a missing/undecodable clip or a blocked
// AudioContext leaves the game fully playable, just silent.

import type { AudioCue } from "./assets";
import { MUTED_KEY } from "./constants";

type OneShot = Exclude<AudioCue, "music">;

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private buffers = new Map<AudioCue, AudioBuffer>();
  private musicSource: AudioBufferSourceNode | null = null;
  private decoded = false;
  private lastPlay = new Map<OneShot, number>();
  muted: boolean;

  constructor(private readonly urls: Record<AudioCue, string>) {
    this.muted = localStorage.getItem(MUTED_KEY) === "1";
  }

  // First user gesture: build the graph, decode the clips, and loop the bed. Cheap and safe
  // to call again (subsequent gestures just ensure the context is running / the bed plays).
  async resume(): Promise<void> {
    try {
      if (!this.ctx) {
        const AC =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.7;
        this.master.connect(this.ctx.destination);
        this.musicGain = this.ctx.createGain();
        this.musicGain.gain.value = 0.34;
        this.musicGain.connect(this.master);
        await this.decodeAll();
      }
      if (this.ctx.state === "suspended") await this.ctx.resume();
      if (!this.muted && !this.musicSource) this.startMusic();
    } catch {
      // Any audio failure is non-fatal — the game plays silently.
    }
  }

  private async decodeAll(): Promise<void> {
    if (!this.ctx) return;
    await Promise.all(
      (Object.keys(this.urls) as AudioCue[]).map(async (name) => {
        const url = this.urls[name];
        if (!url) return;
        try {
          const res = await fetch(url);
          const raw = await res.arrayBuffer();
          const buf = await this.ctx!.decodeAudioData(raw);
          this.buffers.set(name, buf);
        } catch {
          // A missing/undecodable clip is simply silent for that cue.
        }
      }),
    );
    this.decoded = true;
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
    try {
      localStorage.setItem(MUTED_KEY, this.muted ? "1" : "0");
    } catch {
      /* storage unavailable — the toggle still works for this session. */
    }
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.7, this.ctx.currentTime, 0.02);
    }
    if (!this.muted && this.decoded && !this.musicSource) this.startMusic();
  }

  play(cue: OneShot): void {
    if (!this.ctx || !this.master || this.muted) return;
    const buf = this.buffers.get(cue);
    if (!buf) return;
    const now = this.ctx.currentTime;
    // Debounce identical cues fired in the same instant (e.g. an eat + combo on one tick).
    const last = this.lastPlay.get(cue) ?? -1;
    if (now - last < 0.02) return;
    this.lastPlay.set(cue, now);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = cue === "death" ? 0.85 : 0.7;
    src.connect(g).connect(this.master);
    src.start();
  }
}
