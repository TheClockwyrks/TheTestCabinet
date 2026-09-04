// Orrery — input, as engine actions and engine pointer samples
// (specs/controls.md).
//
// The game never sees a `KeyboardEvent` or a `PointerEvent`. It declares NAMED
// ACTIONS with the keys that drive them, and the engine does the listening,
// the edge detection, and the binding, so a dispatched keyboard event opens a
// menu exactly as a player's key does because there is only one path. The
// pointer arrives the same way, already in the stage's logical units, so a hit
// test against a hex center needs no conversion (specs/overview.md).
//
// Every action Orrery has is read as a PRESS EDGE, once per press. The engine
// consumes an edge at the first call that reads it, so `pressedActions` is
// called exactly once per frame and every reader works from the list it
// returns; two readers of one action in one frame would split a single press
// between them.
//
// `Backquote` is deliberately absent from the registry. The debug overlay's
// toggle is engine chrome rather than a game action, so the vocabulary stays
// exactly what `src/constants.ts` fixes.
//
// THE SAMPLES ARE ORDERED, AND EVERY ONE OF THEM IS RESOLVED.
// `specs/controls.md` fixes that: "Each pointer position is resolved on its
// own, in the order the positions arrive, so a drag's ghost and a track being
// laid follow the pointer hex by hex." A drag that crossed three hexes between
// two frames must lay three cells of track, not one, so the frame reads every
// position the pointer passed through rather than only where it finished. The
// engine's `pointerSamples` is what delivers them; the primary pointer's
// samples are the ones the editor answers, because the editor is driven by one
// pointer.

import type { InitApi, UpdateApi } from "@test-cabinet/simple-2d";
import { ACTIONS, BINDINGS } from "./constants";
import type { Action } from "./figures";

/** One pointer event, as the editor reads it: a press, a move, or a release. */
export interface PointerSample {
  readonly type: "down" | "move" | "up";
  /** The logical stage x the sample landed at. */
  readonly x: number;
  /** The logical stage y the sample landed at. */
  readonly y: number;
}

/** Register every action in `ACTIONS`, bound to the keys `BINDINGS` gives it. */
export function registerActions(api: Pick<InitApi, "input">): void {
  for (const action of ACTIONS) {
    api.input.register(action, { keys: [...BINDINGS[action]] });
  }
}

/**
 * This frame's press edges, in the order `ACTIONS` declares them. Reading an
 * edge consumes it, so this is called once per frame and the list it returns
 * is the whole of the frame's keyboard news.
 */
export function pressedActions(api: Pick<UpdateApi, "input">): Action[] {
  return ACTIONS.filter((action) => api.input.pressed(action));
}

/**
 * This frame's pointer samples, in arrival order, reduced to the three facts
 * `specs/controls.md` says the game reads. Only the primary pointer's samples
 * are kept: a second finger on a touchscreen moves nothing in the editor, and
 * a sample carrying a non-primary button reports a position like any other.
 */
export function pointerSamples(api: Pick<UpdateApi, "input">): PointerSample[] {
  return api.input
    .pointerSamples()
    .filter((sample) => sample.primary)
    .map((sample) => ({ type: sample.type, x: sample.x, y: sample.y }));
}
