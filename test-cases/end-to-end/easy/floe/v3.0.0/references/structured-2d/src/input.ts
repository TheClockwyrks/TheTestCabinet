// Floe — the actions the game is driven by.
//
// `specs/controls.md` fixes the eight actions and the `KeyboardEvent.code`
// values each is bound to, and `src/constants.ts` states both tables. The engine
// owns the keyboard: the game registers the vocabulary once, in the instance's
// `initialize`, and reads it back through a player controller and nowhere else
// (engine/input.md).
//
// The backtick key is deliberately absent. It toggles the engine's own debug
// overlay, handled by a listener the engine owns rather than by a registered
// action, so `specs/controls.md` leaves it outside `ACTIONS` and this file
// leaves that key free.

import type { InitApi } from "@clockwyrks/structured-2d";
import { ACTIONS, BINDINGS } from "./constants";

/** Register the eight actions against the keys `BINDINGS` gives them. */
export function registerActions(api: InitApi): void {
  for (const action of ACTIONS) {
    api.input.register(action, { keys: [...BINDINGS[action]] });
  }
}
