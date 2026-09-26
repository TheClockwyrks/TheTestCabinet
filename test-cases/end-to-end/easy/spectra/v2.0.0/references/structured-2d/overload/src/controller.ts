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

import { PlayerController } from "@clockwyrks/structured-2d";
import type { PointerSample } from "@clockwyrks/structured-2d";
import { GAME_OVER_ITEMS, PAUSE_ITEMS, TITLE_ITEMS } from "./constants";
import { noCues, playCues, type FrameCues } from "./audio";
import { startRun, toTitle } from "./flow";
import { spectraState, type Screen, type SpectraState } from "./game";
import { highlightedItem, itemAt, menuOf } from "./menus";
import { fireShot, flipShip, moveShip, releaseDischarge } from "./ship";

/** The next index on a vertical menu, wrapping at both ends. */ function wrap(
  index: number,
  delta: number,
  count: number,
): number {
  return (index + delta + count) % count;
}

/** `HOW TO PLAY`'s index on the title menu (`specs/ui.md`, `TITLE_ITEMS`). */
const HOW_TO_PLAY_INDEX = TITLE_ITEMS.indexOf("HOW TO PLAY");

/** Where one press went down: the screen it landed on, and the item under it. */
interface PressAnchor {
  readonly screen: Screen;
  readonly index: number | null;
}

export class SpectraController extends PlayerController {
  /**
   * Where each press in progress went down.
   *
   * A press and the release that ends it may be frames apart, so the anchor lives
   * across frames; it records the screen as well as the item, so a press that
   * spans a change of screen confirms nothing. It is input bookkeeping rather than
   * game state: nothing in it survives the controller (`specs/state.md`).
   */
  private readonly anchors = new Map<number, PressAnchor>();

  override tick(dt: number): void {
    const state = spectraState(this.world);
    const cues = noCues();
    const opened = state.screen;

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
        // The title comes back on the entry that led here (`specs/ui.md`).
        if (this.input.pressed("back")) toTitle(state, HOW_TO_PLAY_INDEX);
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

    // The pointer and the touch contacts are read once per frame and applied
    // AFTER the frame's keyboard edges (`specs/ui.md`).
    this.pointerFrame(state, opened, cues);

    playCues(this.world.audio, cues);
  }

  /**
   * Apply this frame's pointer samples to the menu on screen.
   *
   * A move onto an item selects it, and so does a landing — which is what makes a
   * finger, which never hovers, select the item it lands on. A confirm takes BOTH
   * its edges inside one item's region: a press and a release in different
   * regions, or either of them outside every region, confirms nothing.
   */
  private pointerFrame(
    state: SpectraState,
    opened: Screen,
    cues: FrameCues,
  ): void {
    // A frame whose keys left the screen has already had its confirm, and the
    // menu the pointer was over is gone; the presses in progress go with it.
    if (state.screen !== opened) {
      this.anchors.clear();
      return;
    }
    for (const sample of this.input.pointerSamples()) {
      this.applySample(state, sample, cues);
    }
  }

  /** One pointer sample, against whichever menu the screen shows. */
  private applySample(
    state: SpectraState,
    sample: PointerSample,
    cues: FrameCues,
  ): void {
    const shown = menuOf(state.screen);
    const index = shown === null ? null : itemAt(shown, sample.x, sample.y);
    if (sample.type === "down") {
      this.anchors.set(sample.id, { screen: state.screen, index });
      // A finger does not hover, so a landing is what selects under touch.
      if (sample.device === "touch" && index !== null) {
        this.select(state, index, cues);
      }
      return;
    }
    if (sample.type === "move") {
      if (index !== null) this.select(state, index, cues);
      return;
    }
    const anchor = this.anchors.get(sample.id);
    this.anchors.delete(sample.id);
    if (
      anchor === undefined ||
      index === null ||
      anchor.index !== index ||
      anchor.screen !== state.screen
    ) {
      return;
    }
    this.select(state, index, cues);
    this.confirm(state, index, cues);
  }

  /** Move the selection to `index`, raising the menu cue if it actually moved. */
  private select(state: SpectraState, index: number, cues: FrameCues): void {
    if (state.menuIndex === index) return;
    state.menuIndex = index;
    cues.menu = true;
  }

  /**
   * Take item `index` of whichever menu the current screen shows.
   *
   * `specs/ui.md` gives the keyboard, the pointer and a finger the same effect,
   * so a pointer confirm runs the very same entry the keyboard's would.
   */
  private confirm(state: SpectraState, index: number, cues: FrameCues): void {
    switch (state.screen) {
      case "title":
        if (index === 0) startRun(state);
        else {
          state.screen = "howto";
          state.menuIndex = 0;
        }
        return;
      case "paused":
        if (index === 0) this.resume(state);
        else if (index === 1) startRun(state);
        else toTitle(state);
        return;
      case "gameOver":
        if (index === 0) startRun(state);
        else toTitle(state);
        return;
      default:
        void cues;
        return;
    }
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
    const shown = menuOf(state.screen);
    if (shown === null) return;
    const moveUp = this.input.pressed("up");
    const moveDown = this.input.pressed("down");
    const accepted = this.input.pressed("confirm");
    if (moveUp || moveDown) {
      state.menuIndex = wrap(
        highlightedItem(shown, state.menuIndex),
        moveUp ? -1 : 1,
        count,
      );
      cues.menu = true;
      return;
    }
    if (accepted) onConfirm(highlightedItem(shown, state.menuIndex));
  }
}
