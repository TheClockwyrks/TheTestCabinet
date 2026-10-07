// Meltdown — input registration, as engine actions.
//
// The game never sees a `KeyboardEvent`. It declares NAMED ACTIONS with the
// keys that drive them (specs/controls.md) and the engine does the listening,
// the edge detection, and the binding. Every action is then read in exactly one
// place — the player controller's tick — because the reader's edges are
// consume-on-read, so two readers of one action in one frame would split a
// single press between them.
//
// `ACTIONS` is deliberately wider than the `dpad-4` layout's vocabulary: the
// floor is built on with the pointer, so the layout carries the four-way pad
// and the menu words alone, and the thirteen the game adds to them sit outside
// it, which the engine allows.

import type { InitApi } from "@clockwyrks/structured-2d";
import { ACTIONS, BINDINGS, LAYOUT } from "./constants";

/**
 * Register every action in `ACTIONS`, bound to the keys `BINDINGS` gives it.
 *
 * The engine's layout is checked first, so an engine stood up without the
 * `dpad-4` scheme this build is written against fails loudly at start-up rather
 * than shipping menus no key can move.
 */
export function registerActions(api: Pick<InitApi, "input">): void {
  const layout = api.input.layout();
  if (layout === null || layout.name !== LAYOUT) {
    throw new Error(
      `Meltdown: the engine must be built with the ${LAYOUT} layout` +
        (layout === null ? "" : `, not ${layout.name}`),
    );
  }
  for (const action of ACTIONS) {
    api.input.register(action, { keys: [...BINDINGS[action]] });
  }
}
