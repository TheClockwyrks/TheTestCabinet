// Coil — input, as engine actions (specs/controls.md).
//
// The game never sees a `KeyboardEvent`. It declares NAMED ACTIONS with the keys
// that drive them, and the engine does the listening, the edge detection, and the
// binding, so a dispatched keyboard event steers the snake exactly as a player's
// key does because there is only one path.
//
// Every Coil action is a press edge: holding a key does nothing beyond the press
// that began it. The engine's edges are consumed per controller at the first call
// that reads them, so every action is read in exactly ONE place — `pressedActions`
// below, called once a frame from the single player controller in
// `src/controller.ts`. A second reader would split one press between the two.
//
// `Backquote` is deliberately absent. The diagnostics overlay's toggle is engine
// chrome rather than a game action, so the registry stays exactly the vocabulary
// `src/constants.ts` fixes.

import { ACTIONS, BINDINGS, LAYOUT, type ActionName } from "./constants";
import type { InitApi, InputReader } from "@clockwyrks/structured-2d";

/**
 * Register every action in `ACTIONS`, bound to its keys.
 *
 * The engine's layout is checked first, so an engine stood up without the
 * `dpad-4` scheme this build is written against fails loudly at start-up rather
 * than shipping a snake no key can steer.
 */
export function registerActions(api: Pick<InitApi, "input">): void {
  const layout = api.input.layout();
  if (layout === null || layout.name !== LAYOUT) {
    throw new Error(
      `Coil: the engine must be built with the ${LAYOUT} layout` +
        (layout ? `, not ${layout.name}` : ""),
    );
  }
  for (const action of ACTIONS) {
    api.input.register(action, { keys: [...BINDINGS[action]] });
  }
}

/**
 * This frame's press edges, in the order `ACTIONS` declares them.
 *
 * Each action is read exactly once, which is what the reader's consume-on-read
 * edges ask for.
 */
export function pressedActions(input: InputReader): ActionName[] {
  return ACTIONS.filter((action) => input.pressed(action));
}
