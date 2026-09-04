// Shatter — the player controller: the one seat input is read from.
//
// The game mode adds a single player possessing nothing, and this controller is
// that player's. Its tick is the ONE place the registered actions are read —
// the reader's edges are consume-on-read per controller, so a second reader
// would split a press — and the one place the frame's input is resolved into
// the state (`specs/state.md`, The contract).
//
// Controllers tick before any actor and before the game mode, so the intent
// this frame's keys produced is the intent this frame's simulation runs on. A
// frame may be worth several ticks, which is why the intent is written onto the
// state rather than applied here: every tick of the frame flies the ship the
// same way.
//
// The two double-bound keys are settled by the SCREEN rather than by the
// binding: on `playing` this reads `pause` and the movement and fire holds, and
// on a screen showing a menu it reads `confirm` and `back`. `Space` therefore
// fires while the game is being played and confirms on a menu, and `Escape`
// pauses while it is being played and leaves the screen otherwise
// (`specs/controls.md`).

import { PlayerController } from "@test-cabinet/structured-2d";
import { GAMEOVER_ITEMS, PAUSE_ITEMS, TITLE_ITEMS } from "./constants";
import { startGame, toTitle } from "./flow";
import { shatterState, type ShatterState } from "./game";

/** The next index on a vertical menu, wrapping at both ends. */
function wrap(index: number, delta: number, count: number): number {
  return (((index + delta) % count) + count) % count;
}

export class ShatterController extends PlayerController {
  override tick(): void {
    const state = shatterState(this.world);

    // Mute works on every screen, so it is read before the per-screen switch.
    if (this.input.pressed("mute")) {
      this.world.audio.setMuted(!this.world.audio.muted());
    }

    // The screen as it stood when the frame began: a menu entry taken here
    // moves the game on, and the new screen's own reading starts next frame.
    switch (state.screen) {
      case "title":
        this.menu(state, TITLE_ITEMS.length, (index) => {
          if (index === 0) startGame(state);
          else {
            state.screen = "howto";
            state.menuIndex = 0;
          }
        });
        break;
      case "howto":
        if (this.input.pressed("back")) toTitle(state);
        break;
      case "playing":
        this.play(state);
        break;
      case "paused":
        if (this.input.pressed("back")) {
          this.resume(state);
          break;
        }
        this.menu(state, PAUSE_ITEMS.length, (index) => {
          if (index === 0) this.resume(state);
          else if (index === 1) startGame(state);
          else toTitle(state);
        });
        break;
      case "gameover":
        this.menu(state, GAMEOVER_ITEMS.length, (index) => {
          if (index === 0) startGame(state);
          else toTitle(state);
        });
        break;
    }
  }

  /** Live play: the pause key, and the holds the ship is flown by. */
  private play(state: ShatterState): void {
    if (this.input.pressed("pause")) {
      state.screen = "paused";
      state.menuIndex = 0;
      state.input.left = false;
      state.input.right = false;
      state.input.thrust = false;
      state.input.fire = false;
      return;
    }

    state.input.left = this.input.value("left") > 0;
    state.input.right = this.input.value("right") > 0;
    state.input.thrust = this.input.value("up") > 0;
    state.input.fire = this.input.value("a") > 0 || this.input.value("b") > 0;
  }

  /** Back to the field, exactly as it stood when it was paused. */
  private resume(state: ShatterState): void {
    state.screen = "playing";
    state.menuIndex = 0;
  }

  /**
   * A vertical menu's frame: `up` and `down` move the highlight and wrap at
   * both ends, and `confirm` accepts it. All three edges are read before any is
   * acted on, so exactly one press moves or accepts and nothing is left armed
   * for a later frame.
   */
  private menu(
    state: ShatterState,
    count: number,
    onConfirm: (index: number) => void,
  ): void {
    const moveUp = this.input.pressed("up");
    const moveDown = this.input.pressed("down");
    const accepted = this.input.pressed("confirm");

    if (moveUp || moveDown) {
      state.menuIndex = wrap(state.menuIndex, moveUp ? -1 : 1, count);
      return;
    }
    if (accepted) onConfirm(state.menuIndex);
  }
}
