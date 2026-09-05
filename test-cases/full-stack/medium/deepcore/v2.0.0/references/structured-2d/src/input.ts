// Deepcore — input registration, as engine actions (specs/controls.md).
//
// The game never sees a `KeyboardEvent` or a `PointerEvent`. It declares the
// NAMED ACTIONS `src/constants.ts` binds, and the engine does the listening, the
// edge detection, and the mapping of the pointer into the stage's logical units.
//
// The actions are then read in exactly ONE place — the player controller's tick
// in `src/controller.ts`, through its own input reader — because the reader's
// edges are consume-on-read per controller: a second reader of the same action
// in one frame would split a single press between them.

import type { InitApi } from "@clockwyrks/structured-2d";
import { ACTION_NAMES, ACTIONS } from "./constants";

/**
 * Register every action in `ACTIONS`, bound to the key codes that drive it.
 *
 * Deepcore is played with the keyboard and the mouse alone, so no touch layout
 * is selected and this table is the whole vocabulary; an engine stood up with a
 * layout would be tagging actions this game does not own, so that is refused
 * here rather than left to surprise a player.
 */
export function registerActions(api: Pick<InitApi, "input">): void {
  const layout = api.input.layout();
  if (layout !== null) {
    throw new Error(
      `Deepcore: the engine must be built with no touch layout, not ${layout.name}`,
    );
  }
  for (const action of ACTION_NAMES) {
    api.input.register(action, { keys: [...ACTIONS[action]] });
  }
}
