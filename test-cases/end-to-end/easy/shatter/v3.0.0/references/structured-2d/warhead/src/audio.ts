// Shatter — the six cues, and the frame's record of which of them were raised.
//
// `specs/audio.md` fixes the six names and the event each answers. They are
// defined once from the game instance's `initialize`, through the engine's cue
// bus, and played from the world's audio inside the mode's tick.
//
// A simulation function never touches the bus. It records what it raised on a
// `FrameCues`, which the mode plays once the frame's ticks have run — so a tick
// raising the same event twice sounds it once, and the pure half of the game
// stays free of the runtime.

import type { InitApi, WorldAudio } from "@clockwyrks/structured-2d";
import { CUES } from "./constants";

/** What one frame raised. `thrust` is held; the rest are one-shots. */
export interface FrameCues {
  fire: boolean;
  shatter: boolean;
  thrust: boolean;
  saucer: boolean;
  death: boolean;
  extraLife: boolean;
}

/** A frame that has raised nothing yet. */
export function noCues(): FrameCues {
  return {
    fire: false,
    shatter: false,
    thrust: false,
    saucer: false,
    death: false,
    extraLife: false,
  };
}

/** Define the six cues on the engine's bus. Runs once, in `initialize`. */
export function defineCues(api: InitApi): void {
  // A short bright tick: the gun.
  api.audio.define(CUES.fire, {
    wave: "square",
    freq: 880,
    freqTo: 520,
    gain: 0.14,
    durationMs: 70,
  });
  // A rock coming apart: a low, fast fall.
  api.audio.define(CUES.shatter, {
    wave: "sawtooth",
    freq: 260,
    freqTo: 70,
    gain: 0.2,
    durationMs: 220,
  });
  // The held burn. A loop holds `freq` at `gain` until it is stopped.
  api.audio.define(CUES.thrust, {
    wave: "sawtooth",
    freq: 110,
    gain: 0.09,
    durationMs: 120,
  });
  // The saucer arriving: a rising warble, unmistakably not a rock.
  api.audio.define(CUES.saucer, {
    wave: "triangle",
    freq: 320,
    freqTo: 760,
    gain: 0.18,
    durationMs: 420,
  });
  // The ship lost: the longest and lowest of the six.
  api.audio.define(CUES.death, {
    wave: "sawtooth",
    freq: 180,
    freqTo: 40,
    gain: 0.24,
    durationMs: 620,
  });
  // A ship awarded: a clean rise, the only cue that climbs to a high note.
  api.audio.define(CUES.extraLife, {
    wave: "sine",
    freq: 520,
    freqTo: 1180,
    gain: 0.2,
    durationMs: 380,
  });
}

/**
 * Sound what the frame raised.
 *
 * The five one-shots are played once each. `thrust` is the exception
 * `specs/audio.md` names: it is held, so it is driven from the state every frame
 * rather than started once — the bus ignores a `loop` on a cue already looping
 * and a `stop` on one that is not.
 */
export function playCues(audio: WorldAudio, cues: FrameCues): void {
  if (cues.fire) audio.play(CUES.fire);
  if (cues.shatter) audio.play(CUES.shatter);
  if (cues.saucer) audio.play(CUES.saucer);
  if (cues.death) audio.play(CUES.death);
  if (cues.extraLife) audio.play(CUES.extraLife);

  if (cues.thrust) audio.loop(CUES.thrust);
  else audio.stop(CUES.thrust);
}
