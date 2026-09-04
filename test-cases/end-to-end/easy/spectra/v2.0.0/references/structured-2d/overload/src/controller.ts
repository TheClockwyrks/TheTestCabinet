// Spectra — the player controller: the one seat input is read from
// (specs/controls.md).
//
// The game mode adds a single player possessing nothing, and this controller is
// that player's. Its tick is the ONE place the registered actions are read — the
// reader's edges are consume-on-read per controller, so a second reader would
// split a press — and the one place the frame's input is resolved into the state
// (`specs/state.md`).
//
// Controllers tick before any actor and before the game mode, so the ship this
// frame's keys moved is the ship the frame's simulation and the frame's picture
// both see.
//
// THE SCREEN DECIDES WHICH ACTION A DOUBLE-BOUND KEY DRIVES, not the binding.
// `Space` fires on the live wave and confirms on a menu; `ArrowUp` and `KeyW` fire
// on the live wave and move a highlight on a menu; `Escape` pauses live play and
// goes back everywhere else. Each screen reads only the actions in its own row of
// `specs/controls.md`, so no key ever does two things at once.

import { PlayerController } from "@test-cabinet/structured-2d";
import { GAME_OVER_ITEMS, PAUSE_ITEMS, TITLE_ITEMS } from "./constants";
import { noCues, playCues, type FrameCues } from "./audio";
import { startRun, toTitle } from "./flow";
import { spectraState, type SpectraState } from "./game";
import { fireShot, flipShip, moveShip, releaseDischarge } from "./ship";

/** The next index on a vertical menu, wrapping at both ends. */ function wrap(
  index: number,
  delta: number,
  count: number,
): number {
  return (index + delta + count) % count;
}

export class SpectraController extends PlayerController {
  override tick(dt: number): void {
    const state = spectraState(this.world);
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
      case "stageIntro":
      case "stageCleared":
        break;
      case "inWave":
        this.play(state, dt, cues);
        break;
      case "paused":
        this.pauseMenu(state, cues);
        break;
      case "gameOver":
        this.menu(state, cues, GAME_OVER_ITEMS.length, (index) => {
          if (index === 0) startRun(state);
          else toTitle(state);
        });
        break;
    }

    playCues(this.world.audio, cues);
  }

  /** Live play: the pause key, and the ship the player flies. */
  private play(state: SpectraState, dt: number, cues: FrameCues): void {
    if (this.input.pressed("pause")) {
      state.screen = "paused";
      state.menuIndex = 0;
      return;
    }
    // The ship is the player's during the `live` phase alone: the ready beat is a
    // pause in the play the run itself owns (`specs/progression.md`).
    if (state.phase !== "live") return;

    moveShip(state, this.input.value("right") - this.input.value("left"), dt);

    if (this.input.pressed("b")) flipShip(state, cues);
    if (this.input.pressed("discharge")) releaseDischarge(state, cues);
    // Fire is a hold: a shot leaves every FIRE_INTERVAL for as long as the action
    // is held and the cap and the lockout allow one (`specs/ship.md`).
    if (this.input.value("a") > 0) fireShot(state, cues);
  }

  /** The pause menu: `pause` and `back` both return to the field. */
  private pauseMenu(state: SpectraState, cues: FrameCues): void {
    const resumed = this.input.pressed("pause") || this.input.pressed("back");
    if (resumed) {
      this.resume(state);
      return;
    }
    this.menu(state, cues, PAUSE_ITEMS.length, (index) => {
      if (index === 0) this.resume(state);
      else if (index === 1) startRun(state);
      else toTitle(state);
    });
  }

  /** Back to the field, exactly as it was when it was paused. */
  private resume(state: SpectraState): void {
    state.screen = "inWave";
    state.menuIndex = 0;
  }

  /**
   * A vertical menu's frame: `up` and `down` move the highlight and wrap at both
   * ends, and `confirm` takes it. All three edges are read before any is acted on,
   * so exactly one press moves or accepts and nothing is left armed for a later
   * frame.
   */
  private menu(
    state: SpectraState,
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
