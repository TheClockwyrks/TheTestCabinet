// Spectra — one frame's worth of player intent.
//
// The runtime's keyboard reports actions; `specs/controls.md` says WHICH ACTIONS
// EACH SCREEN READS, and that table is the whole reason this file exists. Several
// keys drive more than one action — `Space` drives `a` and `confirm`, `ArrowUp` and
// `KeyW` drive `a` and `up`, `Escape` drives `back` and `pause` — and reading only
// the screen's own row is what stops one key doing two things at once.
//
// A HOLD IS READ EVERY SUB-STEP, AN EDGE ACTS ONCE. Intent is read once per frame
// and handed to the sub-step loop; a hold applies in every sub-step, and an edge is
// cleared by the first sub-step that acts on it. That is what makes one press of the
// fire key exactly one bullet however many sub-steps the frame divided into.

import { ACTIONS, type ActionName } from "./constants";
import type { UpdateApi } from "./runtime";
import type { Screen } from "./types";

/** Which actions each screen reads (specs/controls.md). */
export const SCREEN_ACTIONS: Readonly<Record<Screen, readonly ActionName[]>> = {
  title: ["up", "down", "confirm", "mute"],
  howto: ["back", "mute"],
  stageIntro: ["mute"],
  inWave: ["left", "right", "a", "b", "discharge", "pause", "mute"],
  paused: ["up", "down", "confirm", "back", "pause", "mute"],
  stageCleared: ["mute"],
  gameOver: ["up", "down", "confirm", "mute"],
};

/** The actions read as holds; the rest are read as press edges. */
export const HELD_ACTIONS: readonly ActionName[] = ["left", "right", "a"];

/** One frame's intent, as the game acts on it. */
export type Intents = Record<ActionName, boolean>;

/** An intent record with nothing held and nothing pressed. */
export function noIntents(): Intents {
  const intents = {} as Intents;
  for (const action of ACTIONS) intents[action] = false;
  return intents;
}

/**
 * Read this frame's intent for `screen`.
 *
 * An action the screen does not read is never asked for, so its edge is neither
 * consumed nor acted on here.
 */
export function readIntents(api: UpdateApi, screen: Screen): Intents {
  const intents = noIntents();
  for (const action of SCREEN_ACTIONS[screen]) {
    intents[action] = HELD_ACTIONS.includes(action)
      ? api.input.value(action) > 0
      : api.input.pressed(action);
  }
  return intents;
}
