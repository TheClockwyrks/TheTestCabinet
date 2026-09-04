// Shatter — the player controller: the one seat input is read from.
//
// The game mode adds a single player possessing nothing, and this controller is
// that player's. Its tick is the ONE place the registered actions are read — the
// reader's edges are consumed per controller, so a second reader would split a
// press — and the one place the frame's input is resolved into the state.
//
// Controllers tick before the game mode, so the intent this frame's keys
// produced is the intent this frame's ticks run on.
//
// The two double-bound keys are settled by the screen rather than by the
// binding: on `playing` this reads `pause` and the movement, fire and torpedo
// keys, and on a screen showing a menu it reads `confirm` and `back`. `Space`
// therefore fires while the game is being played and confirms on a menu, and
// `Escape` pauses while it is being played and leaves the screen otherwise
// (`specs/controls.md`).

import { PlayerController } from "@test-cabinet/structured-2d";
import { GAMEOVER_ITEMS, PAUSE_ITEMS, TITLE_ITEMS } from "./constants";
import { resumeRun, startRun, toTitle } from "./flow";
import { shatterState, type ShatterState } from "./game";

export class ShatterController extends PlayerController {
  override tick(): void {
    const state = shatterState(this.world);

    // Muting works on every screen, so it is read before the per-screen switch.
    if (this.input.pressed("mute")) {
      this.world.audio.setMuted(!this.world.audio.muted());
    }

    switch (state.screen) {
      case "title":
        this.menu(state, TITLE_ITEMS.length, (index) => {
          if (index === 0) startRun(state);
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
          resumeRun(state);
          break;
        }
        this.menu(state, PAUSE_ITEMS.length, (index) => {
          if (index === 0) resumeRun(state);
          else if (index === 1) startRun(state);
          else toTitle(state);
        });
        break;
      case "gameover":
        this.menu(state, GAMEOVER_ITEMS.length, (index) => {
          if (index === 0) startRun(state);
          else toTitle(state);
        });
        break;
    }
  }

  /**
   * Live play. Rotation, thrust and fire are read as holds, so the ship turns,
   * accelerates and keeps firing for as long as each key is down; the torpedo is
   * read as a press alone, so one launch is armed per press and a held key
   * repeats nothing.
   */
  private play(state: ShatterState): void {
    if (this.input.pressed("pause")) {
      state.screen = "paused";
      state.menuIndex = 0;
      state.intent.turn = 0;
      state.intent.thrust = false;
      state.intent.fire = false;
      return;
    }

    state.intent.turn = this.input.value("right") - this.input.value("left");
    state.intent.thrust = this.input.value("up") > 0;
    state.intent.fire = this.input.value("a") > 0;
    if (this.input.pressed("b")) state.torpedoRequest = true;
  }

  /**
   * A vertical menu's frame: `up` and `down` move the highlight by one entry and
   * wrap at both ends, and `confirm` takes the highlighted one. All three edges
   * are read before any is acted on, so exactly one press moves or accepts and
   * nothing is left armed for a later frame.
   */
  private menu(
    state: ShatterState,
    count: number,
    onConfirm: (index: number) => void,
  ): void {
    const moveUp = this.input.pressed("up");
    const moveDown = this.input.pressed("down");
    const accepted = this.input.pressed("confirm");

    const index = ((Math.round(state.menuIndex) % count) + count) % count;
    if (moveUp || moveDown) {
      state.menuIndex = (index + (moveUp ? -1 : 1) + count) % count;
      return;
    }
    if (accepted) onConfirm(index);
  }
}
