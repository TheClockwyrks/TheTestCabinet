// Carom — the title level: its game mode and the controller that reads the
// menu.
//
// The title level possesses nothing (`pawnClass` is null): its one player
// controller exists to be the seat input reaches the game through, and its
// tick routes the frame's edges into the mode. Reading input FIRST, from a
// controller — controllers tick before any actor — is what specs/ui.md means
// by "each update reads input first": the screen the edges leave the game on
// is the screen everything after them advances.
//
// Choosing SOLO or VERSUS opens the match level with the chosen mode
// (`world.open`), which is how a match starts from every entry point: the
// transition builds the match's world fresh, so starting a match and
// restarting one are the same act (specs/ui.md, "Starting a match").

import { GameMode, PlayerController } from "@test-cabinet/structured-2d";
import type { InputReader } from "@test-cabinet/structured-2d";
import { LEVELS, TITLE_ITEMS } from "./constants";
import { menuDown, menuUp } from "./input";
import { TitleState } from "./state";

export class TitleMode extends GameMode {
  declare readonly state: TitleState;

  gameStateClass = TitleState;
  playerControllerClass = MenuController;
  pawnClass = null;

  beginPlay(): void {
    // One seat: every menu on this level answers to either side's keys, so
    // one controller reads them all.
    this.addPlayer({ name: "MENU" });
  }

  /**
   * One frame's edges, routed by the screen they arrive on. Called by the
   * menu controller at the top of the frame, once, with its own reader — the
   * engine consumes an edge per controller on first read, so a single reader
   * per frame is what keeps one press meaning one thing.
   */
  handleInput(input: InputReader): void {
    // Mute works on every screen, so it is read before the per-screen switch.
    if (input.pressed("mute")) {
      this.world.audio.setMuted(!this.world.audio.muted());
    }

    if (this.state.screen === "howto") {
      // `confirm` and `back` both leave; read both so neither is left armed.
      const accepted = input.pressed("confirm");
      const left = input.pressed("back");
      if (accepted || left) {
        this.state.screen = "title";
        this.state.menuIndex = 0;
      }
      return;
    }

    // The title menu. All three edges are read before any is acted on, and up
    // is applied before down, movement before confirm (specs/ui.md), so
    // exactly one press moves the selection or accepts it.
    const up = menuUp(input);
    const down = menuDown(input);
    const accepted = input.pressed("confirm");
    const count = TITLE_ITEMS.length;
    if (up) {
      this.state.menuIndex = (this.state.menuIndex + count - 1) % count;
      return;
    }
    if (down) {
      this.state.menuIndex = (this.state.menuIndex + 1) % count;
      return;
    }
    if (accepted) this.select(this.state.menuIndex);
  }

  private select(index: number): void {
    if (index === 0) {
      this.world.open(LEVELS.match, { mode: "solo" });
      return;
    }
    if (index === 1) {
      this.world.open(LEVELS.match, { mode: "versus" });
      return;
    }
    this.state.screen = "howto";
    this.state.menuIndex = 0;
  }
}

/** The title level's one seat: it routes the menu edges and drives nothing. */
export class MenuController extends PlayerController {
  tick(): void {
    const mode = this.world.mode;
    if (mode instanceof TitleMode) mode.handleInput(this.input);
  }
}
