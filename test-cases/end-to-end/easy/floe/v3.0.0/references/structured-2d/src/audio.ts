// Floe — audio, as engine cues.
//
// There is no Web Audio graph here, no mute flag, and no autoplay unlock: the
// engine owns the audio context, the synthesis, the mute bit and the
// first-gesture unlock (engine/audio.md). The game's whole part is to DECLARE the
// ten cues `specs/ui.md` names, once, in the instance's `initialize`, and then
// play them BY NAME as the events happen.
//
// The ten are pitched and shaped to be told apart by ear: a short bright blip for
// a hop, a falling gulp for a splash, a hard low crack for a crush, a snarling
// drop for a catch, a rising chime for a bay, a longer fanfare for a level, a
// bright sweep for a bonus life, a long rise for victory, a long fall for the
// run's end, and a soft tick for a menu move.
//
// A CUE SOUNDS ONCE PER TICK however many times its event was raised inside that
// tick (`specs/ui.md`), so the simulation drops the cues it raised into a
// {@link CueBag} and the game mode plays the bag out once the tick has finished.

import type { CueSpec, InitApi, World } from "@clockwyrks/structured-2d";
import { CUES, type CueName } from "./constants";

/** The synthesis behind each of the ten cues. */
const CUE_SPECS: Readonly<Record<CueName, CueSpec>> = {
  [CUES.hop]: {
    wave: "square",
    freq: 520,
    freqTo: 760,
    gain: 0.14,
    durationMs: 60,
  },
  [CUES.splash]: {
    wave: "sine",
    freq: 420,
    freqTo: 90,
    gain: 0.22,
    durationMs: 320,
  },
  [CUES.crush]: {
    wave: "sawtooth",
    freq: 190,
    freqTo: 55,
    gain: 0.24,
    durationMs: 260,
  },
  [CUES.caught]: {
    wave: "sawtooth",
    freq: 300,
    freqTo: 70,
    gain: 0.26,
    durationMs: 420,
  },
  [CUES.bay]: {
    wave: "triangle",
    freq: 480,
    freqTo: 960,
    gain: 0.2,
    durationMs: 220,
  },
  [CUES.levelClear]: {
    wave: "triangle",
    freq: 340,
    freqTo: 1020,
    gain: 0.22,
    durationMs: 520,
  },
  [CUES.bonusLife]: {
    wave: "square",
    freq: 660,
    freqTo: 1320,
    gain: 0.18,
    durationMs: 300,
  },
  [CUES.victory]: {
    wave: "triangle",
    freq: 260,
    freqTo: 1560,
    gain: 0.24,
    durationMs: 900,
  },
  [CUES.gameOver]: {
    wave: "sine",
    freq: 420,
    freqTo: 60,
    gain: 0.24,
    durationMs: 900,
  },
  [CUES.menu]: {
    wave: "square",
    freq: 300,
    gain: 0.1,
    durationMs: 40,
  },
};

/** Declare every cue, once, before the start level opens. */
export function defineCues(api: InitApi): void {
  for (const [cue, spec] of Object.entries(CUE_SPECS)) {
    api.audio.define(cue, spec);
  }
}

/** The cues one tick raised, each held at most once. */
export class CueBag {
  private readonly pending = new Set<CueName>();

  /** Raise a cue. Raising the same one twice in a tick sounds it once. */
  add(cue: CueName): void {
    this.pending.add(cue);
  }

  /** Whether any cue is waiting to sound. */
  get size(): number {
    return this.pending.size;
  }

  /** Play everything raised, in the order it was raised, and empty the bag. */
  flush(audio: World["audio"]): void {
    for (const cue of this.pending) audio.play(cue);
    this.pending.clear();
  }
}
