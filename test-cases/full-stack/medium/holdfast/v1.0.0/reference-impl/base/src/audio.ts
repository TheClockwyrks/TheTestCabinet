// Holdfast — audio playback (ASSETS.md §4 / specs/assets.md "Audio").
//
// The colony's sound is the PRODUCED .wav files (pure sfx-synth cues + a synth-waveform
// music bed), played through the Web Audio API: the cues on their events, and two looped
// beds — the soft ambient frontier wind/hum under everything and the music track that
// LIFTS into tension when a raid lands (and settles again when it clears). Nothing
// autostarts before the first user gesture (browsers block autoplay); a mute toggle is
// provided (specs/controls.md).

import type { Cue } from "./types";
import type { AudioName } from "./assets";

// Bed mix, calm vs. raid. On a raid the music lifts and the ambient bed ducks under it.
const MUSIC_CALM = 0.28;
const MUSIC_RAID = 0.46;
const AMBIENT_CALM = 0.34;
const AMBIENT_RAID = 0.18;
const MASTER_GAIN = 0.6;

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private buffers = new Map<AudioName, AudioBuffer>();
  private musicSource: AudioBufferSourceNode | null = null;
  private ambientSource: AudioBufferSourceNode | null = null;
  private started = false;
  private raid = false;
  private lastPlay = new Map<Cue, number>(); // debounce identical cues in the same instant
  muted = false;

  constructor(private readonly urls: Record<AudioName, string>) {}

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
    this.master.gain.value = MASTER_GAIN;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.raid ? MUSIC_RAID : MUSIC_CALM;
    this.musicGain.connect(this.master);
    this.ambientGain = this.ctx.createGain();
    this.ambientGain.gain.value = this.raid ? AMBIENT_RAID : AMBIENT_CALM;
    this.ambientGain.connect(this.master);

    await Promise.all(
      (Object.keys(this.urls) as AudioName[]).map(async (name) => {
        const url = this.urls[name];
        if (!url) return;
        try {
          const res = await fetch(url);
          const raw = await res.arrayBuffer();
          const buf = await this.ctx!.decodeAudioData(raw);
          this.buffers.set(name, buf);
        } catch {
          // A missing/undecodable clip is non-fatal — that sound is simply silent.
        }
      }),
    );
    this.started = true;
    if (!this.muted) this.startBeds();
  }

  private loopBed(name: AudioName, dest: GainNode): AudioBufferSourceNode | null {
    if (!this.ctx) return null;
    const buf = this.buffers.get(name);
    if (!buf) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(dest);
    src.start();
    return src;
  }

  private startBeds(): void {
    if (!this.ctx || !this.musicGain || !this.ambientGain) return;
    if (!this.musicSource) this.musicSource = this.loopBed("music", this.musicGain);
    if (!this.ambientSource) this.ambientSource = this.loopBed("ambient", this.ambientGain);
  }

  // Raid landed / cleared: lift or settle the beds (a smooth cross-fade).
  setRaid(active: boolean): void {
    if (this.raid === active) return;
    this.raid = active;
    if (!this.ctx || !this.musicGain || !this.ambientGain) return;
    const t = this.ctx.currentTime;
    this.musicGain.gain.setTargetAtTime(active ? MUSIC_RAID : MUSIC_CALM, t, 0.4);
    this.ambientGain.gain.setTargetAtTime(active ? AMBIENT_RAID : AMBIENT_CALM, t, 0.4);
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
    // Debounce a flood of identical cues in the same instant (e.g. many shots a tick).
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
