// Orrery — input, as engine actions and pointer samples (specs/controls.md).
//
// The game never sees a `KeyboardEvent` or a `PointerEvent`. It declares NAMED
// ACTIONS with the keys that drive them, and the engine does the listening, the
// edge detection, and the binding, so a dispatched keyboard event drives the
// editor exactly as a player's key does because there is only one path.
//
// EVERY Orrery action is read as a press edge, once per press
// (specs/controls.md). The engine's edges are consumed per controller at the
// first call that reads them, so every action is read in exactly ONE place —
// `pressedActions` below, called once a frame from the single player controller
// in `src/controller.ts`.
//
// One code may drive several actions: `KeyW` carries both `part-grow` and
// `ins-extend`, and `KeyS` both `part-shrink` and `ins-retract`. Each is
// registered on its own and the editor reads the one the current focus names
// (specs/controls.md "Focus"), so the binding is a many-to-many index the
// engine keeps.
//
// `Backquote` is deliberately absent. The debug overlay's toggle is engine
// chrome rather than a game action, so the registry stays exactly the
// vocabulary `src/constants.ts` fixes.

import type { InitApi, InputReader } from "@test-cabinet/structured-2d";
import { ACTIONS, BINDINGS, type ActionName } from "./constants";
import type { PointerSample } from "./host";

/** Register every action in `ACTIONS`, bound to its keys. */
export function registerActions(api: Pick<InitApi, "input">): void {
  for (const action of ACTIONS) {
    api.input.register(action, { keys: [...BINDINGS[action]] });
  }
}

/**
 * This frame's press edges, in the order `ACTIONS` declares them. Each action
 * is read exactly once, which is what the reader's consume-on-read edges ask
 * for.
 */
export function pressedActions(input: InputReader): ActionName[] {
  return ACTIONS.filter((action) => input.pressed(action));
}

/**
 * This frame's pointer samples, narrowed to what the editor reads: a press, a
 * move, or a release, at a position in the stage's logical units
 * (specs/controls.md "The pointer").
 *
 * The samples are ORDERED and every one of them is resolved, because
 * specs/controls.md decides a lay by the positions the pointer passed through
 * rather than by where it finished: a drag that crossed three hexes between two
 * frames lays three cells of track. Only the primary pointer is followed, which
 * is the one `state.pointer` reports.
 */
export function pointerSamples(input: InputReader): PointerSample[] {
  return input
    .pointerSamples()
    .filter((sample) => sample.primary)
    .map((sample) => ({ type: sample.type, x: sample.x, y: sample.y }));
}
