// Cascade — the cues a frame raises.
//
// `specs/audio.md` fixes two things about when a sound happens: each cue is
// played on the frame its event happens, and at most once on that frame, so a
// frame raising the same event twice still sounds once and a frame raising two
// different events sounds both.
//
// That is the whole of this file. The game's rules RAISE a cue wherever the
// event happens — several of them are reached from outside a frame, through the
// debug surface — and the queue holds what was raised until the next update
// hands it to the audio bus. Nothing here synthesizes anything; that is
// `src/audio-bus.ts`.

import type { CueName } from "./constants";

export class CueQueue {
  /** Insertion-ordered and de-duplicated, which is exactly the rule. */
  private readonly pending = new Set<CueName>();

  /** Raise a cue for the frame being built. Raising one twice sounds once. */
  raise(cue: CueName): void {
    this.pending.add(cue);
  }

  /** What would sound if the queue were flushed now. A pure read. */
  peek(): CueName[] {
    return [...this.pending];
  }

  /** Play everything raised, in the order it was raised, and empty the queue. */
  flush(audio: { play(cue: string): void }): void {
    for (const cue of this.pending) audio.play(cue);
    this.pending.clear();
  }
}
