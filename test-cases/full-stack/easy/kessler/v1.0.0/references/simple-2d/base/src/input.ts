// Kessler — input, as engine actions (specs/controls.md).
//
// The game never sees a `KeyboardEvent`. It declares NAMED ACTIONS with the
// keys that drive them, and the engine does the listening, the edge
// detection, and the binding, so a dispatched keyboard event turns the
// deflector exactly as a player's key does because there is only one path.
//
// `left` and `right` are read as held values through `heldRotation`; every
// other action is a press edge, read exactly once per frame through
// `pressedActions` — the engine consumes an edge at the first call that
// reads it, so two readers of one action in one frame would split a single
// press between them.
//
// `Backquote` is deliberately absent. The debug overlay's toggle is engine
// chrome rather than a game action, so the registry stays exactly the
// vocabulary `src/constants.ts` fixes.

import type { InitApi, UpdateApi } from "@test-cabinet/simple-2d";
import { ACTIONS, BINDINGS, type Action } from "./figures";
import type { Held } from "./flow";

/** Register every action in `ACTIONS`, bound to its keys. */
export function registerActions(api: Pick<InitApi, "input">): void {
  for (const action of ACTIONS) {
    api.input.register(action, { keys: [...BINDINGS[action]] });
  }
}

/** This frame's rotation holds, sampled once and shared by every tick. */
export function heldRotation(api: Pick<UpdateApi, "input">): Held {
  return {
    left: api.input.value("left") > 0,
    right: api.input.value("right") > 0,
  };
}

/**
 * This frame's press edges, in the order `ACTIONS` declares them — `confirm`
 * ahead of `launch`, so the one `Space` press is routed to the screen it
 * arrived on before that screen can change under it.
 */
export function pressedActions(api: Pick<UpdateApi, "input">): Action[] {
  return ACTIONS.filter((action) => api.input.pressed(action));
}
