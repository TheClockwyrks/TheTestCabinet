// Spectra — input registration, as engine actions (specs/controls.md).
//
// The game never sees a `KeyboardEvent`. It declares NAMED ACTIONS with the keys
// that drive them, and the engine does the listening, the edge detection and the
// binding. The actions are then read in exactly one place — the player
// controller's tick in `src/controller.ts`, through its own input reader —
// because the reader's edges are consume-on-read: two readers of the same action
// in one frame would split one press between them.
//
// The whole of `ACTIONS` is registered, which is the layout's own vocabulary
// (`dpad-4-two-buttons`: a four-way pad and two buttons) plus `discharge` and the
// menu and system actions every layout carries.

import type { InitApi } from "@clockwyrks/structured-2d";
import { ACTIONS, BINDINGS, LAYOUT } from "./constants";

/**
 * Register every action in `ACTIONS`, bound to the keys `BINDINGS` gives it.
 *
 * The engine's layout is checked first, so an engine stood up without the
 * `dpad-4-two-buttons` scheme this build is written against fails loudly at
 * start-up rather than shipping a ship no key moves.
 */
export function registerActions(api: Pick<InitApi, "input">): void {
  const layout = api.input.layout();
  if (layout === null || layout.name !== LAYOUT) {
    throw new Error(
      `Spectra: the engine must be built with the ${LAYOUT} layout` +
        (layout ? `, not ${layout.name}` : ""),
    );
  }
  for (const action of ACTIONS) {
    api.input.register(action, { keys: [...BINDINGS[action]] });
  }
}
