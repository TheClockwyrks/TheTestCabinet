// Orrery — audio, as engine cues (specs/ui.md "Audio", specs/assets.md "The
// sound").
//
// There is no Web Audio graph here, no mute flag, and no autoplay unlock: the
// engine owns the context, the looping, and the first-gesture unlock. The
// game's whole part is to DECLARE the seven cues `src/constants.ts` names,
// once, from the instance's `initialize`, and then play each one BY NAME on the
// world's cue bus on the frame its event resolves, and keep the music bed
// looping.
//
// Each name is DECLARED TWICE, and the order matters. A synthesized shape is
// defined first, which cannot fail, and the produced `.wav` `specs/assets.md`
// fixes is then loaded over the same name, which replaces what that name plays.
// The produced files are what a player hears. What the first declaration buys
// is the requirement that audio which fails to load leaves the game running:
// the engine throws on a cue name that was never declared, so a build that
// declared nothing until a fetch resolved would fall over on a host that could
// not reach its files instead of carrying on, quieter, exactly as specified.
//
// The bed loops from the first frame, on every screen (specs/ui.md).

import type { CueSpec, InitApi, WorldAudio } from "@clockwyrks/structured-2d";
import { CUES, CUE_PATHS, LOOPING_CUES, type CueName } from "./constants";
import { CUE_NAMES } from "./figures";

/**
 * The shape each cue falls back to when its produced file is unavailable,
 * pitched the way the produced palette is (`specs/assets.md`, "The sound bar"):
 * bright brass for the two editing cues, a rising winding for `start` and a
 * falling one for `halt`, a chime for a delivered constellation, the longest
 * and highest sound of the set for a completed machine, and a low held pad for
 * the bed.
 */
export const CUE_FALLBACKS: Readonly<Record<CueName, CueSpec>> = {
  [CUES.place]: {
    wave: "triangle",
    freq: 520,
    freqTo: 700,
    gain: 0.16,
    durationMs: 80,
  },
  [CUES.erase]: {
    wave: "square",
    freq: 380,
    freqTo: 190,
    gain: 0.12,
    durationMs: 110,
  },
  [CUES.start]: {
    wave: "sawtooth",
    freq: 180,
    freqTo: 540,
    gain: 0.18,
    durationMs: 420,
  },
  [CUES.halt]: {
    wave: "sawtooth",
    freq: 420,
    freqTo: 90,
    gain: 0.2,
    durationMs: 560,
  },
  [CUES.constellation]: {
    wave: "sine",
    freq: 660,
    freqTo: 990,
    gain: 0.18,
    durationMs: 260,
  },
  [CUES.complete]: {
    wave: "triangle",
    freq: 523,
    freqTo: 1568,
    gain: 0.22,
    durationMs: 1400,
  },
  [CUES.music]: {
    wave: "sine",
    freq: 98,
    gain: 0.05,
    durationMs: 1000,
  },
};

/**
 * Declare every cue, once, before the one level opens, and load the produced
 * file behind each over it.
 *
 * A load that fails is caught rather than thrown: the name keeps the shape its
 * fallback gave it, the game stays fully playable, and the engine has already
 * announced the failure as an `asset:failed` event for anyone watching.
 */
export async function defineCues(api: Pick<InitApi, "audio">): Promise<void> {
  for (const cue of CUE_NAMES) api.audio.define(cue, CUE_FALLBACKS[cue]);
  await Promise.all(
    CUE_NAMES.map((cue) =>
      api.audio.load(cue, CUE_PATHS[cue]).catch(() => undefined),
    ),
  );
}

/**
 * Keep the music bed looping, on every screen, from the first frame
 * (specs/ui.md "Audio"). `loop` is idempotent on the engine's bus, so this is
 * reconciled from the game mode's tick rather than started once.
 */
export function syncBed(audio: WorldAudio): void {
  for (const cue of LOOPING_CUES) audio.loop(cue);
}

/** Whether a cue loops until stopped rather than playing once. */
export function looping(cue: CueName): boolean {
  return LOOPING_CUES.includes(cue);
}
