// Kessler — input, as engine actions (specs/controls.md).
//
// The game never sees a `KeyboardEvent`. It declares NAMED ACTIONS with the
// keys that drive them, and the engine does the listening, the edge
// detection, and the binding, so a dispatched keyboard event turns the
// deflector exactly as a player's key does because there is only one path.
//
// `left` and `right` are read as held values through `input.value`; every
// other action is a press edge. The engine's edges are consumed per
// controller at the first call that reads them, so every edge action is read
// in exactly ONE place — `pressedActions` below, called once a frame from the
// single player controller in `src/controller.ts`.
//
// `Backquote` is deliberately absent. The debug overlay's toggle is engine
// chrome rather than a game action, so the registry stays exactly the
// vocabulary `src/constants.ts` fixes.

import { ACTIONS, BINDINGS, type ActionName } from "./constants";
import type { PointerMove } from "./flow";
import type { InitApi, InputReader } from "@clockwyrks/structured-2d";

/** The actions read as one press edge per press, in `ACTIONS` order. */
export const EDGE_ACTIONS: readonly ActionName[] = ACTIONS.filter(
  (action) => action !== "left" && action !== "right",
);

/** Register every action in `ACTIONS`, bound to its keys. */
export function registerActions(api: Pick<InitApi, "input">): void {
  for (const action of ACTIONS) {
    api.input.register(action, { keys: [...BINDINGS[action]] });
  }
}

/**
 * This frame's press edges, in the order `ACTIONS` declares them. Each edge
 * action is read exactly once, which is what the reader's consume-on-read
 * edges ask for.
 */
export function pressedActions(input: InputReader): ActionName[] {
  return EDGE_ACTIONS.filter((action) => input.pressed(action));
}

/**
 * This frame's pointer samples, in arrival order, in the stage's own logical
 * units. A mouse, a pen and a touch contact all arrive here the same way, so
 * the menus answer any of them (`specs/controls.md`). The engine has already
 * mapped each position through the letterboxed fit, so nothing here reads the
 * device pixel ratio or the canvas.
 */
export function pointerMoves(input: InputReader): PointerMove[] {
  return input
    .pointerSamples()
    .filter((sample) => sample.primary)
    .map((sample) => ({ type: sample.type, x: sample.x, y: sample.y }));
}
