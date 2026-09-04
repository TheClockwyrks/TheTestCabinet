// Wireworm — the player controller: the one seat input is read from.
//
// The game mode adds a single player possessing nothing, and this controller is
// that player's. Its tick is the ONE place the registered actions are read — the
// reader's edges are consume-on-read per controller, so a second reader would
// split a press — and the one place the frame's input is resolved into the state
// (`specs/state.md`, The contract).
//
// Controllers tick before any actor and before the game mode, so the cursor this
// frame's keys moved is the cursor the frame's simulation and the frame's
// picture both see.
//
// The two double-bound keys are settled by the screen rather than by the
// binding: on `playing` this reads `pause` and the movement and fire holds, and
// on a screen showing a menu it reads `confirm` and `back`. `Space` therefore
// fires while the game is being played and confirms on a menu, and `Escape`
// pauses while it is being played and leaves the screen otherwise
// (`specs/controls.md`).

import { PlayerController } from "@test-cabinet/structured-2d";
import { noCues, playCues, type FrameCues } from "./audio";
import { ENDING_ITEMS, PAUSE_ITEMS, TITLE_ITEMS } from "./constants";
import { resolveCursorIntent } from "./cursor";
import { startRun, toTitle } from "./flow";
import { wirewormState, type WirewormState } from "./game";

/** The next index on a vertical menu, wrapping at both ends. */
function wrap(index: number, delta: number, count: number): number {
  return (index + delta + count) % count;
}

export class WirewormController extends PlayerController {
  override tick(dt: number): void {
    const state = wirewormState(this.world);
    const cues = noCues();

    // Mute works on every screen, so it is read before the per-screen switch.
    if (this.input.pressed("mute")) {
      this.world.audio.setMuted(!this.world.audio.muted());
    }

    switch (state.screen) {
      case "title":
        this.menu(state, cues, TITLE_ITEMS.length, (index) => {
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
        this.play(state, dt, cues);
        break;
      case "paused":
        if (this.input.pressed("back")) {
          this.resume(state);
          break;
        }
        this.menu(state, cues, PAUSE_ITEMS.length, (index) => {
          if (index === 0) this.resume(state);
          else if (index === 1) startRun(state);
          else toTitle(state);
        });
        break;
      case "victory":
      case "gameover":
        this.menu(state, cues, ENDING_ITEMS.length, (index) => {
          if (index === 0) startRun(state);
          else toTitle(state);
        });
        break;
    }

    playCues(this.world.audio, cues);
  }

  /** Live play: the pause key, and the movement and fire the cursor is driven by. */
  private play(state: WirewormState, dt: number, cues: FrameCues): void {
    if (this.input.pressed("pause")) {
      state.screen = "paused";
      state.menuIndex = 0;
      return;
    }
    // The cursor is the player's during live play alone: the banner and the
    // respawn are pauses in the play the run itself owns.
    if (state.phase !== "active") return;
    resolveCursorIntent(
      state,
      dt,
      {
        left: this.input.value("left") > 0,
        right: this.input.value("right") > 0,
        up: this.input.value("up") > 0,
        down: this.input.value("down") > 0,
        fire: this.input.value("a") > 0 || this.input.value("b") > 0,
      },
      cues,
    );
  }

  /** Back to the board, exactly as it was when it was paused. */
  private resume(state: WirewormState): void {
    state.screen = "playing";
    state.menuIndex = 0;
  }

  /**
   * A vertical menu's frame: `up` and `down` move the highlight and wrap at both
   * ends, and `confirm` accepts it. All three edges are read before any is acted
   * on, so exactly one press moves or accepts and nothing is left armed for a
   * later frame.
   */
  private menu(
    state: WirewormState,
    cues: FrameCues,
    count: number,
    onConfirm: (index: number) => void,
  ): void {
    const moveUp = this.input.pressed("up");
    const moveDown = this.input.pressed("down");
    const accepted = this.input.pressed("confirm");
    if (moveUp || moveDown) {
      state.menuIndex = wrap(state.menuIndex, moveUp ? -1 : 1, count);
      cues.menu = true;
      return;
    }
    if (accepted) onConfirm(state.menuIndex);
  }
}
