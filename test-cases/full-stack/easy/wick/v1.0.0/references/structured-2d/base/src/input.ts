// Wick — input, as engine actions (specs/controls.md).
//
// The game never sees a `KeyboardEvent`. It registers the eight named actions
// with the keys that drive them, and the engine does the listening, the edge
// detection, and the binding, so a dispatched keyboard event moves the
// lamplighter exactly as a player's key does because there is only one path.
//
// The four movement actions are read as held values through `input.value` on
// `playing`; every action is a press edge on the menus. The engine's edges
// are consumed per controller at the first call that reads them, so every
// edge is read in exactly one place: `pressedActions` below, called once a
// frame from the single player controller in `src/controller.ts`.
//
// `Backquote` is deliberately absent. The debug overlay's toggle is engine
// chrome rather than a game action, so the registry stays exactly the
// vocabulary `src/constants.ts` fixes.

import type { InitApi, InputReader } from "@test-cabinet/structured-2d";
import { ACTIONS, BINDINGS, type ActionName } from "./constants";
import type { Held } from "./state";

/** Register every action in `ACTIONS`, bound to its keys. */
export function registerActions(api: Pick<InitApi, "input">): void {
  for (const action of ACTIONS) {
    api.input.register(action, { keys: [...BINDINGS[action]] });
  }
}

/** The four movement actions as held values, `1` while down. */
export function heldMovement(input: InputReader): Held {
  return {
    up: input.value("up") > 0 ? 1 : 0,
    down: input.value("down") > 0 ? 1 : 0,
    left: input.value("left") > 0 ? 1 : 0,
    right: input.value("right") > 0 ? 1 : 0,
  };
}

/**
 * This frame's press edges, in the order `ACTIONS` declares them. Each edge
 * is read exactly once, which is what the reader's consume-on-read edges ask
 * for.
 */
export function pressedActions(input: InputReader): ActionName[] {
  return ACTIONS.filter((action) => input.pressed(action));
}
