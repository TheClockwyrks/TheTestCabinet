// Shatter — the action registrations.
//
// `specs/controls.md` fixes the layout, the ten actions and the key bound to
// each, and `src/constants.ts` holds all three. Registration belongs to the game
// instance's `initialize`, which runs before the start level opens, so the
// vocabulary is complete before the first frame reads it.
//
// The whole of `ACTIONS` is registered, in order, each under the binding
// `BINDINGS` gives it. Nothing binds `Backquote`: the debug overlay's toggle is
// the engine's own chrome rather than one of Shatter's actions.

import type { InitApi } from "@test-cabinet/structured-2d";
import { ACTIONS, BINDINGS } from "./constants";

/** Register every action Shatter answers to. */
export function registerActions(api: InitApi): void {
  for (const action of ACTIONS) {
    api.input.register(action, BINDINGS[action]);
  }
}
