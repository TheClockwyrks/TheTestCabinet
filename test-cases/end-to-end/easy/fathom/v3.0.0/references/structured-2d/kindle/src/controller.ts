// Fathom — the player controller: the one seat input is read from.
//
// The game mode adds a single player possessing nothing, and this controller is
// that player's. Its tick is the ONE place the registered actions are read — the
// reader's edges are consume-on-read per controller, so a second reader would
// split a press — and each screen reads exactly the actions its own row of
// `specs/movement.md` names and leaves the rest alone, which is how `Space`
// drives the pulse in play and the menu everywhere else.
//
// The controller holds no authoritative state: everything it decides is written
// straight onto the world's `FathomState`, through the transitions in
// `src/flow.ts` and the abilities in `src/sim.ts`. Controllers tick before any
// actor does, so the trench's draw components render the state this frame's
// input produced, and the mode's tick advances the simulation from the desired
// direction settled here.

import { PlayerController } from "@test-cabinet/structured-2d";
import { noCues, playCues } from "./audio";
import { GAMEOVER_ITEMS, PAUSE_ITEMS, TITLE_ITEMS } from "./constants";
import { beginDive, toTitle } from "./flow";
import type { Dir } from "./grid";
import { MOVE_ACTIONS } from "./input";
import { emitSonar, releaseInk } from "./sim";
import { fathomState, type FathomState } from "./game";

/** The next index on a vertical menu, wrapping at both ends. */
function wrap(index: number, delta: number, count: number): number {
  return (index + delta + count) % count;
}

export class FathomController extends PlayerController {
  override tick(): void {
    const state = fathomState(this.world);

    // The mute control is read on every screen, so it is read before the
    // per-screen switch (specs/ui.md).
    if (this.input.pressed("mute")) {
      this.world.audio.setMuted(!this.world.audio.muted());
    }

    switch (state.screen) {
      case "title":
        this.menu(state, TITLE_ITEMS.length, (index) => {
          if (index === 0) beginDive(state);
          else {
            state.screen = "howto";
            state.menuIndex = 0;
          }
        });
        return;
      case "howto":
        // Both the confirmation and the back control leave for the title, and
        // both edges are read so neither is left armed for a later frame.
        if (this.leaves()) toTitle(state);
        return;
      case "paused":
        this.pauseMenu(state);
        return;
      case "gameover":
        if (this.input.pressed("back")) {
          toTitle(state);
          return;
        }
        this.menu(state, GAMEOVER_ITEMS.length, (index) => {
          if (index === 0) beginDive(state);
          else toTitle(state);
        });
        return;
      case "playing":
        this.play(state);
        return;
      default:
        // The countdown and the cleared interstitial read the mute control
        // alone, and it has already been read.
        return;
    }
  }

  /** Live play: the four movement actions held, the two abilities, the pause. */
  private play(state: FathomState): void {
    const pause = this.input.pressed("pause");
    const pulse = this.input.pressed("a");
    const ink = this.input.pressed("b");
    this.steer(state);

    if (pause) {
      state.screen = "paused";
      state.menuIndex = 0;
      return;
    }

    const cues = noCues();
    if (pulse) emitSonar(state, cues);
    if (ink) releaseInk(state, cues);
    playCues(this.world.audio, cues);
  }

  /**
   * The desired direction the forager travels on. A movement action sets it and
   * it holds until another replaces it, so a newly pressed direction wins, a
   * direction whose key has been let go falls back to whatever is still held,
   * and nothing held at all brings the forager to rest (`specs/movement.md`).
   */
  private steer(state: FathomState): void {
    const held: Dir[] = [];
    for (const [action, dir] of MOVE_ACTIONS) {
      if (this.input.value(action) > 0) held.push(dir);
    }
    const fresh = held.filter((dir) => !state.heldDirs.includes(dir));
    if (fresh.length > 0) {
      state.desired = fresh[fresh.length - 1];
    } else if (state.desired === null || !held.includes(state.desired)) {
      state.desired = held[0] ?? null;
    }
    state.heldDirs = held;
  }

  /** The pause menu, which `back` leaves the same way `RESUME` does. */
  private pauseMenu(state: FathomState): void {
    if (this.input.pressed("back")) {
      state.screen = "playing";
      state.menuIndex = 0;
      return;
    }
    this.menu(state, PAUSE_ITEMS.length, (index) => {
      if (index === 0) {
        state.screen = "playing";
        state.menuIndex = 0;
      } else if (index === 1) {
        beginDive(state);
      } else {
        toTitle(state);
      }
    });
  }

  /** Reads and consumes both of the edges that leave a screen. */
  private leaves(): boolean {
    const accepted = this.input.pressed("confirm");
    const back = this.input.pressed("back");
    return accepted || back;
  }

  /**
   * A vertical menu's frame: `up` and `down` move the highlight and wrap at
   * both ends, and `confirm` takes the highlighted item. All three edges are
   * read before any is acted on, so exactly one press moves or accepts and
   * nothing is left armed for a later frame.
   */
  private menu(
    state: FathomState,
    count: number,
    onConfirm: (index: number) => void,
  ): void {
    const moveUp = this.input.pressed("up");
    const moveDown = this.input.pressed("down");
    const accepted = this.input.pressed("confirm");
    if (moveUp) state.menuIndex = wrap(state.menuIndex, -1, count);
    else if (moveDown) state.menuIndex = wrap(state.menuIndex, 1, count);
    else if (accepted) onConfirm(state.menuIndex);
  }
}
