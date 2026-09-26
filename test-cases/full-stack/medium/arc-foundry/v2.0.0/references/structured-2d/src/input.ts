// Arc Foundry — input registration, as engine actions (specs/controls.md).
//
// The game never sees a `KeyboardEvent` or a `PointerEvent`. It declares the named
// actions `src/constants.ts` fixes against the keys that drive them, and the engine does
// the listening, the edge detection, and the mapping of a pointer position into the
// stage's logical units.
//
// READING IS SOMEWHERE ELSE, AND IN EXACTLY ONE PLACE. Actions and the pointer reach the
// game only through `PlayerController.input`, and that reader's edges are consumed per
// controller, so the single player's controller in `src/controller.ts` is the one seat
// they are read from: a second reader in the same frame would split one press between
// the two. Registration is all that belongs here, and it runs once, from the game
// instance's `initialize`, before the start level opens.

import type { InitApi } from "@clockwyrks/structured-2d";
import { ACTIONS, BINDINGS, LAYOUT } from "./constants";

/**
 * Register every action against its keys.
 *
 * The engine's layout is checked first, so an engine stood up without the layout this
 * build speaks fails loudly at start-up rather than shipping menus no key can move. The
 * action list is deliberately wider than that layout's vocabulary: the build controls,
 * the speed and overlay toggles, and `modify` are Arc Foundry's own and sit beyond it.
 */
export function registerActions(api: Pick<InitApi, "input">): void {
  const layout = api.input.layout();
  if (layout === null || layout.name !== LAYOUT) {
    throw new Error(
      `Arc Foundry: the engine must be built with the ${LAYOUT} layout` +
        (layout ? `, not ${layout.name}` : ""),
    );
  }
  for (const action of ACTIONS) {
    api.input.register(action, { keys: [...BINDINGS[action]] });
  }
}
