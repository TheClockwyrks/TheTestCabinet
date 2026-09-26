// Facet — input registration, as engine actions.
//
// The game never sees a `KeyboardEvent`. It declares NAMED ACTIONS with the
// keys that drive them (specs/controls.md), and the engine does the listening,
// the edge detection, and the binding. The actions are then read in exactly one
// place — the player controller's tick in `src/controller.ts`, through its own
// input reader — because the reader's edges are consume-on-read: two readers of
// the same action in one frame would split one press between them.
//
// The pointer is the other half of the input and is deliberately not here: the
// controller reads its ordered samples and resolves them one at a time through
// `src/core/controls.ts`, because a move is decided by the positions the
// pointer passed through and by where the hold was let go rather than by where
// it ended up.

import type { InitApi } from "@clockwyrks/structured-2d";
import { ACTIONS, BINDINGS, LAYOUT } from "./constants";

/**
 * Register every action in `ACTIONS`, bound to the keys in `BINDINGS`.
 *
 * The engine's layout is checked first, so an engine stood up without the
 * `single-vertical` scheme this build is written against fails loudly at
 * start-up rather than shipping menus no key can move. `ACTIONS` is exactly
 * that layout's vocabulary: the two movement actions the one vertical highlight
 * needs, and the menu actions appended to every layout (src/constants.ts).
 */
export function registerActions(api: Pick<InitApi, "input">): void {
  const layout = api.input.layout();
  if (layout === null || layout.name !== LAYOUT) {
    throw new Error(
      `Facet: the engine must be built with the ${LAYOUT} layout` +
        (layout ? `, not ${layout.name}` : ""),
    );
  }
  for (const action of ACTIONS) {
    api.input.register(action, { keys: [...BINDINGS[action]] });
  }
}
