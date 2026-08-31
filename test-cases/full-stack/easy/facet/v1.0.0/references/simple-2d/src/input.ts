// Facet — input, as the engine's named actions.
//
// The game never sees a `KeyboardEvent`. It declares NAMED ACTIONS with the keys
// that drive them (specs/controls.md), and the engine does the listening, the
// binding, and the edge detection. `ACTIONS` is exactly the vocabulary the
// `dpad-4` layout `LAYOUT` names brings — the four directions plus the four menu
// actions appended to every layout — so the scheme and the bindings agree.
//
// Every read below is an EDGE read: "each action is read once per frame as a
// press edge". The engine consumes an edge on the first call that sees it, so
// each action is read in exactly one place per frame, which is `readActions` in
// `src/frame.ts`.
//
// The pointer is the other half of the input and is deliberately not here: its
// samples are resolved one at a time through `src/core/controls.ts`, because a
// drag is decided by the positions the pointer passed through rather than by
// where it ended up.

import { ACTIONS, BINDINGS } from "./constants";
import type { FacetState } from "./game";
import type { InitApi, UpdateApi } from "@test-cabinet/simple-2d";

/** Register every action in `ACTIONS`, bound to the keys in `BINDINGS`. */
export function registerActions(api: Pick<InitApi<FacetState>, "input">): void {
  for (const action of ACTIONS) {
    api.input.register(action, { keys: [...BINDINGS[action]] });
  }
}

/** This frame's press edge for one action, consumed by the read. */
export function pressed(
  api: Pick<UpdateApi, "input">,
  action: string,
): boolean {
  return api.input.pressed(action);
}
