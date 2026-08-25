// Refract — input registration, as engine actions.
//
// The game never sees a KeyboardEvent. It declares NAMED ACTIONS with the keys
// that drive them (specs/controls.md), and the engine does the listening, the
// edge detection, and the binding. The actions are then read in exactly one
// place — the player controller's tick in `src/controller.ts`, through its own
// input reader — because the reader's edges are consume-on-read: two readers
// of the same action in one frame would split one press between them.
//
// The pointer is the other half of the input and is deliberately not here: the
// controller reads its ordered samples and resolves them one at a time through
// `src/tracing.ts`, because a beam grows and unwinds node by node as the
// pointer travels.

import type { InitApi } from "@test-cabinet/structured-2d";
import { ACTIONS, BINDINGS, LAYOUT } from "./constants";

/**
 * Register every action in ACTIONS, bound to its keys.
 *
 * The engine's layout is checked first, so an engine stood up without the
 * `dpad-4` scheme this build is written against fails loudly at start-up
 * rather than shipping menus no key can move. ACTIONS is deliberately not the
 * layout's exact vocabulary: `clear` is Refract's own, beyond the layout, and
 * `pause` goes unregistered because a board is left with `back`, not paused
 * (src/constants.ts).
 */
export function registerActions(api: Pick<InitApi, "input">): void {
  const layout = api.input.layout();
  if (layout === null || layout.name !== LAYOUT) {
    throw new Error(
      `Refract: the engine must be built with the ${LAYOUT} layout` +
        (layout ? `, not ${layout.name}` : ""),
    );
  }
  for (const action of ACTIONS) {
    api.input.register(action, { keys: [...BINDINGS[action]] });
  }
}
