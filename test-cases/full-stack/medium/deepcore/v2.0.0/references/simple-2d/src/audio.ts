// Deepcore — audio, as engine cues (specs/assets.md).
//
// There is no audio graph here, no mute flag, and no autoplay unlock: the engine
// owns the context, the mute bit, and the first-gesture unlock. The game's whole
// part is to DECLARE the thirteen cues `src/constants.ts` names, once, over the
// produced `.wav` files, and then to play them BY NAME as the events happen.
//
// Ten of the thirteen are one-shots and three are loops, plus the music bed,
// which loops under the whole game. A frame's rules push the one-shots it raised
// onto the draft and set the loops that should be sounding when it ends; this
// module plays each one-shot once and reconciles the loops, so a cue sounds on
// the frame its event happened and a loop starts and stops on the frame its
// condition changed.
//
// Every cue is DECLARED before it is loaded. The engine throws on a play of a
// name it does not know, and a produced clip that fails to decode leaves its
// name unbound, so each name is first given a quiet synthesized stand-in and the
// produced file is loaded over it. In a finished build the stand-in is never
// heard; what it buys is that a frame cannot be brought down by a missing file.

import { CUES } from "./constants";
import type { CueName } from "./constants";
import type { Draft } from "./state";
import type { CueSpec, InitApi, UpdateApi } from "@test-cabinet/simple-2d";

/** The cues that sound continuously while their condition holds. */
export const LOOP_CUES = [
  CUES.drill,
  CUES.thrust,
  CUES.alarmFuel,
  CUES.alarmCore,
  CUES.music,
] as const;

export type LoopCue = (typeof LOOP_CUES)[number];

/** The cues that sound once, on the frame their event happened. */
export const ONE_SHOT_CUES = [
  CUES.orePickup,
  CUES.materialChime,
  CUES.gasExplosion,
  CUES.lavaSizzle,
  CUES.impact,
  CUES.fabricate,
  CUES.launch,
  CUES.death,
] as const;

export type OneShotCue = (typeof ONE_SHOT_CUES)[number];

/** The produced clip each cue is backed by, under the engine's asset root. */
export function cuePath(cue: CueName): string {
  return `audio/${cue}.wav`;
}

/**
 * The stand-in each cue is declared with before its produced clip is loaded over
 * it. They are pitched apart so a build running before its audio has been
 * produced is still legible by ear, and quiet enough that one slipping through
 * is obvious rather than pleasant.
 */
const STAND_IN: Readonly<Record<CueName, CueSpec>> = {
  [CUES.drill]: { wave: "sawtooth", freq: 90, gain: 0.05, durationMs: 200 },
  [CUES.thrust]: { wave: "sawtooth", freq: 140, gain: 0.05, durationMs: 200 },
  [CUES.orePickup]: {
    wave: "triangle",
    freq: 660,
    freqTo: 990,
    gain: 0.08,
    durationMs: 90,
  },
  [CUES.materialChime]: {
    wave: "sine",
    freq: 520,
    freqTo: 1040,
    gain: 0.09,
    durationMs: 240,
  },
  [CUES.gasExplosion]: {
    wave: "square",
    freq: 180,
    freqTo: 60,
    gain: 0.1,
    durationMs: 300,
  },
  [CUES.lavaSizzle]: {
    wave: "sawtooth",
    freq: 320,
    freqTo: 200,
    gain: 0.06,
    durationMs: 220,
  },
  [CUES.impact]: {
    wave: "square",
    freq: 150,
    freqTo: 70,
    gain: 0.08,
    durationMs: 120,
  },
  [CUES.fabricate]: {
    wave: "triangle",
    freq: 440,
    freqTo: 880,
    gain: 0.08,
    durationMs: 180,
  },
  [CUES.launch]: {
    wave: "sawtooth",
    freq: 110,
    freqTo: 440,
    gain: 0.1,
    durationMs: 900,
  },
  [CUES.death]: {
    wave: "sawtooth",
    freq: 300,
    freqTo: 60,
    gain: 0.1,
    durationMs: 700,
  },
  [CUES.alarmFuel]: { wave: "square", freq: 620, gain: 0.05, durationMs: 200 },
  [CUES.alarmCore]: { wave: "square", freq: 380, gain: 0.05, durationMs: 200 },
  [CUES.music]: { wave: "sine", freq: 110, gain: 0.03, durationMs: 1000 },
};

/** Every cue name, in the order `src/constants.ts` lists them. */
export const CUE_NAMES: readonly CueName[] = Object.values(CUES);

/**
 * Declare every cue, once, before the first frame: the stand-in first, then the
 * produced clip loaded over it. A clip that cannot be fetched or decoded leaves
 * its stand-in in place rather than failing the whole initialization.
 */
export async function defineCues(api: Pick<InitApi, "audio">): Promise<void> {
  for (const cue of CUE_NAMES) api.audio.define(cue, STAND_IN[cue]);
  await Promise.all(
    CUE_NAMES.map((cue) =>
      api.audio.load(cue, cuePath(cue)).catch(() => undefined),
    ),
  );
}

/**
 * Play what the frame raised: each one-shot once, and the loops reconciled
 * against what is already sounding, so a loop starts and stops exactly on the
 * frame its condition changed.
 */
export function playFrame(api: Pick<UpdateApi, "audio">, d: Draft): void {
  for (const cue of d.cues) api.audio.play(cue);
  d.cues.length = 0;
  // The bed sounds under every screen, so it is wanted whatever the frame set.
  d.loops.add(CUES.music);
  for (const cue of LOOP_CUES) {
    const wanted = d.loops.has(cue);
    const sounding = api.audio.looping(cue);
    if (wanted && !sounding) api.audio.loop(cue);
    else if (!wanted && sounding) api.audio.stop(cue);
  }
}

/** Raise a one-shot cue on this frame. */
export function cue(d: Draft, name: OneShotCue): void {
  d.cues.push(name);
}
