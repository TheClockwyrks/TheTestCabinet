// Refract — the player controller: the one seat input is read from.
//
// The game mode adds a single player possessing nothing, and this controller
// is that player's. Its tick is the ONE place the registered actions are read
// — the reader's edges are consume-on-read per controller, so a second reader
// would split a press — and the one place the engine's ordered pointer samples
// reach the game, each resolved on its own through `src/tracing.ts`, in
// arrival order (specs/controls.md).
//
// The controller holds no authoritative state: everything it decides is
// written straight onto the world's `RefractState`, through the transitions in
// `src/flow.ts` and the resolvers in `src/tracing.ts`. Controllers tick before
// any actor does, so the bench's draw components render the state this frame's
// input produced. The cues a tick's events raise are played once per kind at
// the end of the tick, and the pointer mirror is refreshed last, so
// `state.pointer` reports the engine's own snapshot for the frame being drawn
// (specs/state.md).

import { PlayerController } from "@clockwyrks/structured-2d";
import { playEvents } from "./audio";
import { CAMPAIGN_LENGTH, SOLVED_ITEMS, TITLE_ITEMS } from "./constants";
import {
  campaignSolvedItems,
  confirmItem,
  enterSelected,
  goBack,
} from "./flow";
import { refractState, type RefractState } from "./game";
import { COMPLETE_ITEMS, SELECT_COLS } from "./layout";
import { applySample } from "./pointer";
import { clearBeams, mergeEvents, noEvents } from "./tracing";

/** The next index on a vertical menu, wrapping at both ends. */
function wrap(index: number, delta: number, count: number): number {
  return (index + delta + count) % count;
}

// The select grid: `SELECT_COLS` columns by `SELECT_ROWS` rows of campaign
// boards. `left`/`right` wrap within the row, `up`/`down` wrap between rows in
// the same column (specs/modes/campaign.md).

export class RefractController extends PlayerController {
  override tick(): void {
    const state = refractState(this.world);

    // Mute works on every screen, so it is read before the per-screen switch.
    if (this.input.pressed("mute")) {
      this.world.audio.setMuted(!this.world.audio.muted());
    }

    const clear = this.handleActions(state);
    const events = noEvents();

    // The pointer's samples, each resolved on its own, in arrival order, so a
    // sweep that crossed several cells between two frames grows or unwinds
    // the beam node by node rather than jumping to the last position. Each
    // sample's own trace events are merged into the tick's, so one cue plays
    // per kind of event however many samples raised it.
    for (const sample of this.input.pointerSamples()) {
      // The primary pointer alone operates the game, so a second finger
      // resting on a touchscreen changes nothing (specs/controls.md).
      if (!sample.primary) continue;
      mergeEvents(events, applySample(state, sample));
    }

    // `state.pointer` is written by the resolution every sample goes through,
    // so it already holds what this tick read — and a scenario posed through
    // the debug surface, which feeds that same path, survives the frame that
    // follows it (specs/instrumentation.md).
    playEvents(this.world.audio, { ...events, clear: clear || events.cleared });
  }

  /**
   * Read this frame's one-shot actions and act on them. Returns whether the
   * `clear` action removed a segment, the one case its cue plays for.
   */
  private handleActions(state: RefractState): boolean {
    switch (state.screen) {
      case "title":
        this.menu(state, TITLE_ITEMS.length);
        return false;
      case "howto":
        if (this.input.pressed("back")) goBack(state);
        return false;
      case "select":
        this.selectGrid(state);
        return false;
      case "playing": {
        // Both edges are read before either is acted on. `back` leaves the
        // board — to the grid in Campaign, to the title in Cascade — and the
        // beams drawn on it are discarded either way.
        const leave = this.input.pressed("back");
        const clearNow = this.input.pressed("clear");
        if (leave) {
          goBack(state);
          return false;
        }
        return clearNow ? clearBeams(state) : false;
      }
      case "solved": {
        if (this.input.pressed("back")) {
          goBack(state);
          return false;
        }
        const count =
          state.mode === "campaign"
            ? campaignSolvedItems(state.boardIndex).length
            : SOLVED_ITEMS.length;
        this.menu(state, count);
        return false;
      }
      case "complete":
        if (this.input.pressed("back")) {
          goBack(state);
          return false;
        }
        this.menu(state, COMPLETE_ITEMS.length);
        return false;
    }
  }

  /**
   * A vertical menu's frame: `up` and `down` move the highlight, `confirm`
   * accepts it. All three edges are read before any is acted on, so exactly
   * one press moves or accepts and nothing is left armed for a later frame.
   *
   * `confirm` and the pointer's `menu-<i>` targets both reach `confirmItem` in
   * `src/flow.ts`, so a choice means the same thing however it was made
   * (specs/controls.md).
   */
  private menu(state: RefractState, count: number): void {
    const moveUp = this.input.pressed("up");
    const moveDown = this.input.pressed("down");
    const accepted = this.input.pressed("confirm");
    if (moveUp) state.menuIndex = wrap(state.menuIndex, -1, count);
    else if (moveDown) state.menuIndex = wrap(state.menuIndex, 1, count);
    else if (accepted) confirmItem(state, state.menuIndex);
  }

  /**
   * The select grid's frame: the highlight wraps within its row and between
   * rows in the same column, `confirm` enters an unlocked board, and a locked
   * board leaves the highlight where it is (specs/modes/campaign.md).
   */
  private selectGrid(state: RefractState): void {
    const moveLeft = this.input.pressed("left");
    const moveRight = this.input.pressed("right");
    const moveUp = this.input.pressed("up");
    const moveDown = this.input.pressed("down");
    const accepted = this.input.pressed("confirm");
    if (this.input.pressed("back")) {
      goBack(state);
      return;
    }

    const selectRows = CAMPAIGN_LENGTH / SELECT_COLS;
    const col = state.selectIndex % SELECT_COLS;
    const row = Math.floor(state.selectIndex / SELECT_COLS);
    let nextCol = col;
    let nextRow = row;
    if (moveLeft) nextCol = wrap(col, -1, SELECT_COLS);
    else if (moveRight) nextCol = wrap(col, 1, SELECT_COLS);
    else if (moveUp) nextRow = wrap(row, -1, selectRows);
    else if (moveDown) nextRow = wrap(row, 1, selectRows);
    const index = nextRow * SELECT_COLS + nextCol;
    if (index !== state.selectIndex) {
      state.selectIndex = index;
      return;
    }

    // `confirm` on a locked board does nothing and leaves the highlight put,
    // which `enterSelected` is what decides (specs/modes/campaign.md).
    if (accepted) enterSelected(state);
  }
}
