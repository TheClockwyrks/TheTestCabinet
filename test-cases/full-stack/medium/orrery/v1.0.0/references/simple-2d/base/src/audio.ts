// Orrery — audio, as engine cues (specs/ui.md "Audio", specs/assets.md "The
// sound").
//
// There is no Web Audio graph here, no mute flag, and no autoplay unlock: the
// engine owns the context, the looping, and the first-gesture unlock. Orrery's
// whole part is to DECLARE the seven cues `src/constants.ts` names, bind each
// to its produced file through the cue bus, play the six one-shot cues by name
// as their events happen, and keep the bed looping on every screen.
//
// Each name is DECLARED TWICE, and the order matters. A synthesized shape is
// defined first, which cannot fail, and the produced `.wav` is then loaded
// over the same name, which replaces what that name plays. The produced files
// are what a player hears. What the first declaration buys is the requirement
// that audio which fails to load leaves the game running: a name that was
// never declared throws when it is played, so a build that declared nothing
// until a load resolved would fall over on a host that could not reach its
// files instead of carrying on, quieter, exactly as specified
// (specs/assets.md).
//
// The shapes below are pitched the way the produced sounds are (specs/assets.md
// "The sound bar"): `place` and `erase` short and light and clearly apart by
// ear, `start` rising into motion, `halt` falling and unmistakably failure,
// `constellation` a bright arrival, `complete` the brightest sound in the game,
// and the bed a quiet drone under all of them.

import type { CueSpec, InitApi, UpdateApi } from "@test-cabinet/simple-2d";
import { CUES, CUE_PATHS } from "./constants";
import { CUE_NAMES, type Cue } from "./figures";

/** The shape each cue falls back to when its produced file is unavailable. */
export const CUE_FALLBACKS: Readonly<Record<Cue, CueSpec>> = {
  [CUES.place]: {
    wave: "triangle",
    freq: 520,
    freqTo: 660,
    gain: 0.16,
    durationMs: 80,
  },
  [CUES.erase]: {
    wave: "triangle",
    freq: 440,
    freqTo: 300,
    gain: 0.14,
    durationMs: 90,
  },
  [CUES.start]: {
    wave: "sawtooth",
    freq: 160,
    freqTo: 440,
    gain: 0.18,
    durationMs: 420,
  },
  [CUES.halt]: {
    wave: "sawtooth",
    freq: 300,
    freqTo: 60,
    gain: 0.22,
    durationMs: 700,
  },
  [CUES.constellation]: {
    wave: "sine",
    freq: 784,
    freqTo: 1175,
    gain: 0.16,
    durationMs: 240,
  },
  [CUES.complete]: {
    wave: "triangle",
    freq: 523,
    freqTo: 1568,
    gain: 0.2,
    durationMs: 1200,
  },
  [CUES.music]: {
    wave: "sine",
    freq: 98,
    gain: 0.05,
    durationMs: 1000,
  },
};

/**
 * Declare every cue, once, before the first frame, and load the produced file
 * behind each over its name. A load that fails is caught: the name keeps its
 * synthesized shape, the game stays fully playable, and the engine has already
 * announced the failure as an `asset:failed` event.
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
 * Keep the bed looping. `music` loops from the first frame on every screen and
 * in every sim status (specs/ui.md), so this is reconciled every frame rather
 * than started once: the engine makes `loop` idempotent, so a frame that
 * changes nothing loops nothing, and a bed the engine could not start before
 * its file decoded starts on the first frame it can.
 */
export function syncBed(api: Pick<UpdateApi, "audio">): void {
  if (!api.audio.looping(CUES.music)) api.audio.loop(CUES.music);
}

/** Play the cues a frame's transitions raised, once each, in the order asked. */
export function playCues(
  api: Pick<UpdateApi, "audio">,
  cues: readonly Cue[],
): void {
  for (const cue of cues) api.audio.play(cue);
}
