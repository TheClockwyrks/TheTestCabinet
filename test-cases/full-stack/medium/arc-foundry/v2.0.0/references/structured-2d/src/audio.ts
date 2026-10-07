// Arc Foundry — audio, as engine cues (specs/ui.md, specs/assets.md).
//
// There is no audio graph here, no mute flag, and no autoplay unlock: the engine owns
// the context, the mixing, the mute bit, and the first-gesture unlock, and the game's
// whole part is to declare the twelve cues `src/constants.ts` names, once, and play them
// by name as their events happen.
//
// WHAT A CUE PLAYS. Each of the twelve is backed by the produced `.wav`
// `specs/assets.md` fixes for it, loaded over the name in `src/assets.ts`. The shapes
// below are what the same name is declared as first: a short synthesized stand-in per
// cue, in the same register and of the same length as the clip that replaces it. That
// ordering matters, because the engine throws on a cue that was never declared and a
// file may be unreachable — under a validator with no page behind it, for one — so the
// declaration is what keeps a run audible and keeps a raised event observable whatever
// arrived.
//
// WHAT PLAYS WHEN. `specs/ui.md` fixes one cue per event, and the simulation raises each
// at most once per frame, so a frame on which a whole pack dies plays one kill cue.

import {
  CUES,
  type ComboId,
  type ComponentType,
  type CueName,
} from "./constants";
import type { Component } from "./types";
import type { CueSpec, WorldAudio } from "@clockwyrks/structured-2d";

/**
 * The synthesized shape each cue is declared with, before the produced clip is loaded
 * over the same name. Pitched and shaped so the eleven effects are told apart by ear.
 */
export const CUE_SPECS: Readonly<Record<CueName, CueSpec>> = {
  [CUES.stamp]: {
    wave: "square",
    freq: 180,
    freqTo: 120,
    gain: 0.16,
    durationMs: 90,
  },
  [CUES.fireBolt]: {
    wave: "sine",
    freq: 640,
    freqTo: 420,
    gain: 0.1,
    durationMs: 55,
  },
  [CUES.fireSpark]: {
    wave: "triangle",
    freq: 1180,
    freqTo: 900,
    gain: 0.06,
    durationMs: 32,
  },
  [CUES.fireChain]: {
    wave: "sawtooth",
    freq: 520,
    freqTo: 880,
    gain: 0.1,
    durationMs: 90,
  },
  [CUES.fireDischarge]: {
    wave: "sawtooth",
    freq: 240,
    freqTo: 90,
    gain: 0.14,
    durationMs: 150,
  },
  [CUES.combine]: {
    wave: "triangle",
    freq: 392,
    freqTo: 1046,
    gain: 0.2,
    durationMs: 260,
  },
  [CUES.kill]: {
    wave: "square",
    freq: 300,
    freqTo: 160,
    gain: 0.09,
    durationMs: 70,
  },
  [CUES.leak]: {
    wave: "sawtooth",
    freq: 160,
    freqTo: 70,
    gain: 0.24,
    durationMs: 380,
  },
  [CUES.slow]: {
    wave: "sine",
    freq: 460,
    freqTo: 240,
    gain: 0.08,
    durationMs: 110,
  },
  [CUES.burn]: {
    wave: "sawtooth",
    freq: 300,
    freqTo: 380,
    gain: 0.07,
    durationMs: 120,
  },
  [CUES.settle]: {
    wave: "square",
    freq: 130,
    freqTo: 82,
    gain: 0.18,
    durationMs: 200,
  },
  [CUES.music]: {
    wave: "triangle",
    freq: 98,
    gain: 0.1,
    durationMs: 4000,
  },
};

/** The firing family a base type's shot belongs to (specs/ui.md). */
const TYPE_FIRE_CUE: Readonly<Record<ComponentType, CueName>> = {
  capacitor: CUES.fireBolt,
  choke: CUES.fireBolt,
  rectifier: CUES.fireBolt,
  emitter: CUES.fireSpark,
  coil: CUES.fireChain,
  arcnode: CUES.fireDischarge,
  discharge: CUES.fireDischarge,
  // The Regulator never fires. Its entry names the family it would belong to.
  regulator: CUES.fireBolt,
};

/**
 * The family a combination tower's shot belongs to: its dominant output. A chaining
 * tower plays the chain, a splashing or heavy one the discharge, a rapid multi-target
 * array the spark, and a plain single-target tower the bolt.
 */
const COMBO_FIRE_CUE: Readonly<Record<ComboId, CueName>> = {
  fusecluster: CUES.fireDischarge,
  staticweb: CUES.fireChain,
  slagdriver: CUES.fireDischarge,
  corroder: CUES.fireBolt,
  ionprism: CUES.fireDischarge,
  forkarray: CUES.fireSpark,
  nullcore: CUES.fireDischarge,
  rupturenode: CUES.fireDischarge,
  blightcoil: CUES.fireChain,
  reactorpile: CUES.fireChain,
  auroralance: CUES.fireChain,
  singularity: CUES.fireDischarge,
};

/** The cue a structure's shot plays. */
export function fireCue(c: Component): CueName {
  return c.combo ? COMBO_FIRE_CUE[c.combo] : TYPE_FIRE_CUE[c.type];
}

/**
 * Play the cues the frame raised, each once, and keep the music bed running.
 *
 * The bed loops from the first build phase onward and stops when the run leaves the
 * yard, which is the one cue whose start and stop the frame decides rather than an
 * event.
 */
export function playFrameCues(
  audio: WorldAudio,
  cues: readonly CueName[],
  playing: boolean,
): void {
  for (const cue of cues) if (cue !== CUES.music) audio.play(cue);
  const looping = audio.looping(CUES.music);
  if (playing && !looping) audio.loop(CUES.music);
  if (!playing && looping) audio.stop(CUES.music);
}
