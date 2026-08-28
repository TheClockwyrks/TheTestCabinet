// Fathom — input registration, as engine actions.
//
// The game never sees a KeyboardEvent. It declares NAMED ACTIONS with the keys
// that drive them (`specs/movement.md`), and the engine does the listening, the
// binding and the edge detection. The actions are read in exactly one place —
// the player controller's tick in `src/controller.ts`, through that controller's
// own reader — because the reader's edges are consume-on-read: two readers of
// one action in a frame would split a single press between them.
//
// `ACTIONS` is the `dpad-4-two-buttons` layout's whole vocabulary, in the
// layout's own order, so the scheme the engine was built with and the bindings
// registered here agree.

import type { InitApi } from "@test-cabinet/structured-2d";
import { ACTIONS, BINDINGS, LAYOUT } from "./constants";
import type { ActionName } from "./constants";
import type { Dir } from "./grid";

/**
 * Register every action in `ACTIONS`, bound to the keys `BINDINGS` gives it.
 *
 * The engine's layout is checked first, so an engine stood up without the
 * `dpad-4-two-buttons` scheme this build is written against fails loudly at
 * start-up rather than shipping a forager no key can steer.
 */
export function registerActions(api: Pick<InitApi, "input">): void {
  const layout = api.input.layout();
  if (layout === null || layout.name !== LAYOUT) {
    throw new Error(
      `Fathom: the engine must be built with the ${LAYOUT} layout` +
        (layout ? `, not ${layout.name}` : ""),
    );
  }
  for (const action of ACTIONS) {
    api.input.register(action, { keys: [...BINDINGS[action]] });
  }
}

/** The action each cardinal direction is steered by, in scan order. */
export const MOVE_ACTIONS: readonly (readonly [ActionName, Dir])[] = [
  ["up", "up"],
  ["down", "down"],
  ["left", "left"],
  ["right", "right"],
];
