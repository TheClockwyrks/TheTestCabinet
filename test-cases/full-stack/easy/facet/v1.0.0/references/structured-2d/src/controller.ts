// Facet — the player controller: the one seat input is read from.
//
// The game mode adds a single player possessing nothing, and this controller is
// that player's. Its tick is the ONE place the registered actions are read —
// the reader's edges are consume-on-read per controller, so a second reader
// would split a press — and the one place the engine's ordered pointer samples
// reach the game, each resolved on its own, in arrival order
// (specs/controls.md).
//
// EVERY ARMED ACTION IS APPLIED, IN A FIXED ORDER, to the state the one before
// it left. Every edge is read before any is acted on, because the reader
// consumes an edge on the first read and the engine discards whatever is left
// armed when the input frame closes — an action held back for a later frame
// would simply be lost. So a frame carrying both an arrow and a `confirm` moves
// the cursor and then acts on the cell it moved to, which is what a player who
// pressed both between two repaints meant, and what a scenario driving the
// menus with real key events gets whether or not a frame happened to fall
// between its presses.
//
// The controller holds no authoritative state: everything it decides is written
// straight onto the world's `FacetState`, through the core's own transitions.
// What it does keep for the length of one tick is the BATCH those transitions
// made — the cues they raised and the chain steps they resolved — which
// `FacetMode.tick` takes and merges with the chain's own. The cues are not
// played here, because a swap that clears in this tick and a second step that
// clears in the same frame's chain are one `clear`, not two (specs/ui.md).

import { PlayerController } from "@test-cabinet/structured-2d";
import { applyCore, toCore } from "./bridge";
import { facetState } from "./game";
import { fold, openBatch, type StepBatch } from "./steps";
import {
  confirm,
  goBack,
  moveHorizontal,
  moveVertical,
  pointerDown,
  pointerMove,
  pointerUp,
  quiet,
  togglePause,
} from "./core";

export class FacetController extends PlayerController {
  /**
   * What this tick's input raised, for the game mode to merge with the chain's.
   * It is per-tick scratch rather than state: each tick replaces it wholesale,
   * and the mode drains it in the same frame.
   */
  private batch: StepBatch | null = null;

  /** The tick's batch, taken. Reading it clears it. */
  takeBatch(): StepBatch | null {
    const taken = this.batch;
    this.batch = null;
    return taken;
  }

  override tick(): void {
    const state = facetState(this.world);

    // Mute is read on every screen, and it drives the engine's bus rather than
    // the state; `FacetMode.tick` mirrors the bit back onto `state.muted`.
    if (this.input.pressed("mute")) {
      this.world.audio.setMuted(!this.world.audio.muted());
    }

    const moveUp = this.input.pressed("up");
    const moveDown = this.input.pressed("down");
    const moveLeft = this.input.pressed("left");
    const moveRight = this.input.pressed("right");
    const accept = this.input.pressed("confirm");
    const leave = this.input.pressed("back");
    const held = this.input.pressed("pause");

    const batch = openBatch(toCore(state));
    const at = (): typeof batch.state => batch.state;

    if (held) fold(batch, quiet(togglePause(at())));
    if (leave) fold(batch, quiet(goBack(at())));
    if (moveUp) fold(batch, quiet(moveVertical(at(), -1)));
    if (moveDown) fold(batch, quiet(moveVertical(at(), 1)));
    if (moveLeft) fold(batch, quiet(moveHorizontal(at(), -1)));
    if (moveRight) fold(batch, quiet(moveHorizontal(at(), 1)));
    if (accept) fold(batch, confirm(at()));

    // The pointer's samples, each resolved on its own, in arrival order, so a
    // drag that crossed several cells between two frames is read as every
    // position it visited rather than as the last one alone.
    for (const sample of this.input.pointerSamples()) {
      if (sample.type === "down") {
        fold(batch, pointerDown(at(), sample.x, sample.y));
      } else if (sample.type === "move") {
        fold(batch, pointerMove(at(), sample.x, sample.y));
      } else {
        fold(batch, quiet(pointerUp(at())));
      }
    }

    applyCore(state, batch.state);
    // The engine's own snapshot, mirrored for the frame being drawn
    // (specs/state.md, PointerState).
    state.pointer = this.input.pointer();
    this.batch = batch;
  }
}
