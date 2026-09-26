// Volute — playing the produced cues through the engine's bus (specs/ui.md
// "Audio").
//
// Fifteen cues, each a produced `.wav` bound to its name by `audio.load` during
// initialization: thirteen one-shots played on their event and two beds that
// loop under the hall. Nothing is synthesized.
//
// Every play routes through here for one reason: the engine throws on a cue
// that was never declared, and `audio.load` declares a name only once its file
// has decoded. A hall whose sound did not arrive should still play, so a name
// that is not available is simply not played.

import type { World } from "@clockwyrks/structured-2d";
import { CUES } from "./constants";
import type { CueName } from "./constants";
import { cueAvailable } from "./assets";

/** Sound a one-shot cue, once. */
export function playCue(world: World, cue: CueName): void {
  if (cueAvailable(cue)) world.audio.play(cue);
}

/** Start a bed looping, if it is not already. */
export function loopCue(world: World, cue: CueName): void {
  if (cueAvailable(cue) && !world.audio.looping(cue)) world.audio.loop(cue);
}

/** Stop a bed, if it is looping. */
export function stopCue(world: World, cue: CueName): void {
  if (cueAvailable(cue) && world.audio.looping(cue)) world.audio.stop(cue);
}

/**
 * Run the two music beds: exactly one loops on `playing`, chosen by the danger
 * condition, and neither loops on any other screen.
 *
 * Driven from the state on every tick rather than tracked, which is what the
 * engine's `audio.md` asks for and what makes the change happen on the tick the
 * danger condition changes.
 */
export function runBeds(world: World, playing: boolean, danger: boolean): void {
  if (!playing) {
    stopCue(world, CUES.hallLoop);
    stopCue(world, CUES.dangerLoop);
    return;
  }
  const wanted = danger ? CUES.dangerLoop : CUES.hallLoop;
  const other = danger ? CUES.hallLoop : CUES.dangerLoop;
  stopCue(world, other);
  loopCue(world, wanted);
}
