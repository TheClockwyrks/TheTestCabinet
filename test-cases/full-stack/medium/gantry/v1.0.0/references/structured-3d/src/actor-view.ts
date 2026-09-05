// The one thing every actor Gantry draws with has in common.
//
// `specs/state.md` fixes the whole authoritative game in `GantryState`, so the
// actors and components here hold nothing of their own: each is handed one
// reading of the live state a frame and brings what it draws into line with it.
// The game mode is what hands it over, after the frame's ticks have advanced
// the state and before the pipeline draws, so what is on screen is the state as
// this frame left it rather than as the frame before it did.
//
// The reading is taken once and shared, because three of its four parts cost
// real work — the posture runs the simulation's own geometry, the pick projects
// every lattice node, and the hint runs the editor's rules — and every actor
// that needs one needs the same one.

import { Actor } from "@clockwyrks/structured-3d";
import { pick, type Pick } from "./editor";
import { pointerHint, type PointerHint } from "./hint";
import { yardPosture, type YardPosture } from "./posture";
import type { GantryState } from "./game";

/** One frame's reading of the state, shared by every actor that draws it. */
export interface ViewFrame {
  readonly state: GantryState;
  /** Where everything in the yard stands this frame (`src/posture.ts`). */
  readonly posture: YardPosture;
  /** What a click at the pointer would take (`specs/controls.md`). */
  readonly pick: Pick;
  /** What that click would do, or the rule that would refuse it. */
  readonly hint: PointerHint;
}

/** Take the frame's reading. Pure: it leaves the state exactly as it found it. */
export function viewFrame(state: GantryState): ViewFrame {
  const picked = pick(state);
  return {
    state,
    posture: yardPosture(state),
    pick: picked,
    hint: pointerHint(state, picked),
  };
}

export class GantryView extends Actor {
  /**
   * Bring what this actor draws in line with the frame. The base does nothing,
   * so an actor whose components read the state at the draw itself — a
   * `DrawComponent` — overrides nothing.
   */
  refresh(_frame: ViewFrame): void {}
}
