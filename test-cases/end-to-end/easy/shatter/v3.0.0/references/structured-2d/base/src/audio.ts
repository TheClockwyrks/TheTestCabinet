// Shatter — audio, as engine cues.
//
// There is no Web Audio graph here, no mute flag and no autoplay unlock: the
// engine owns the context, the synthesis, the mute state and the first-gesture
// unlock. The game's whole part is to DECLARE the six cues `src/constants.ts`
// names, once, from the instance's `initialize`, and then play them BY NAME on
// the world's cue bus as the events happen (`specs/audio.md`).
//
// A frame collects what it raised into one `FrameCues` and plays from that at
// the end of the mode's tick, which is what upholds the rule that each cue is
// played on the tick its event happens and AT MOST ONCE on that tick: a tick
// that shattered three rocks still plays `shatter` once.
//
// `thrust` is the exception the specification names: it is HELD. It is driven
// from the ship's own `thrusting` field on every frame rather than from an
// event, because the engine's `loop` and `stop` are idempotent — which is what
// makes "starts on the tick thrust begins and stops within a tenth of a second
// of its release" a consequence of the state rather than of bookkeeping.
//
// The six are pitched and shaped to be told apart by ear: a dry click for a
// shot, a low crumble for a rock coming apart, a held rumble for the burn, a
// warbling swoop as the saucer arrives, a long fall for a lost ship, and a
// rising two-note lift for an awarded one.

import type { CueSpec, InitApi, WorldAudio } from "@test-cabinet/structured-2d";
import { CUES, type CueName } from "./constants";
import type { ShatterState } from "./game";

export const CUE_SPECS: Readonly<Record<CueName, CueSpec>> = {
  [CUES.fire]: {
    wave: "square",
    freq: 880,
    freqTo: 460,
    gain: 0.09,
    durationMs: 45,
  },
  [CUES.shatter]: {
    wave: "sawtooth",
    freq: 260,
    freqTo: 70,
    gain: 0.18,
    durationMs: 220,
  },
  [CUES.thrust]: {
    wave: "sawtooth",
    freq: 96,
    gain: 0.1,
    durationMs: 120,
  },
  [CUES.saucer]: {
    wave: "triangle",
    freq: 300,
    freqTo: 760,
    gain: 0.16,
    durationMs: 420,
  },
  [CUES.death]: {
    wave: "sawtooth",
    freq: 320,
    freqTo: 60,
    gain: 0.24,
    durationMs: 700,
  },
  [CUES.extraLife]: {
    wave: "triangle",
    freq: 523,
    freqTo: 1319,
    gain: 0.2,
    durationMs: 380,
  },
};

/** Declare every cue, once, before the start level opens. */
export function defineCues(api: Pick<InitApi, "audio">): void {
  for (const [cue, spec] of Object.entries(CUE_SPECS)) {
    api.audio.define(cue, spec);
  }
}

/** What one frame of advanced game raised, each flag one cue played once. */
export interface FrameCues {
  fire: boolean;
  shatter: boolean;
  saucer: boolean;
  death: boolean;
  extraLife: boolean;
}

/** A batch that has raised nothing yet. */
export function noCues(): FrameCues {
  return {
    fire: false,
    shatter: false,
    saucer: false,
    death: false,
    extraLife: false,
  };
}

/**
 * Play the cue for each event the batch raised, once per kind, and hold the
 * thrust cue for exactly as long as thrust is being applied on the field.
 *
 * A batch that raised more than one kind plays each of those once; a batch that
 * raised none plays nothing. The burn is silenced the moment play stops, so a
 * paused game — which advances nothing and plays nothing — is silent.
 */
export function playCues(
  audio: WorldAudio,
  state: ShatterState,
  cues: FrameCues,
): void {
  if (cues.fire) audio.play(CUES.fire);
  if (cues.shatter) audio.play(CUES.shatter);
  if (cues.saucer) audio.play(CUES.saucer);
  if (cues.death) audio.play(CUES.death);
  if (cues.extraLife) audio.play(CUES.extraLife);

  const burning = state.screen === "playing" && state.ship.thrusting;
  if (burning) audio.loop(CUES.thrust);
  else audio.stop(CUES.thrust);
}
