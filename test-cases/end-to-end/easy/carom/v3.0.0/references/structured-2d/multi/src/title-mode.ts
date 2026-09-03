// Carom — the title level: its game mode and the controller that reads the
// menus.
//
// The title level possesses nothing (`pawnClass` is null): its one player
// controller exists to be the seat input reaches the game through, and its
// tick routes the frame's edges into the mode. Reading input FIRST, from a
// controller — controllers tick before any actor — is what specs/ui.md means
// by "each update reads input first": the screen the edges leave the game on
// is the screen everything after them advances.
//
// Neither of its screens advances anything (specs/ui.md), so the level spawns
// the standard field for the picture behind the menu and no rally to run it.
// A pose that takes the game to a live screen moves it to the match level,
// which is where the balls fly.
//
// Choosing SOLO or VERSUS opens the match level with the chosen mode, which is
// how a match starts from every entry point: the transition builds the match's
// world fresh, so starting a match and restarting one are the same act
// (specs/ui.md, "Starting a match"). Every path off this level's how-to screen
// goes back to the title through the one return the instance owns, so the
// remembered selection is restored the same way from all of them.

import { GameMode, PlayerController } from "@test-cabinet/structured-2d";
import type { InputReader } from "@test-cabinet/structured-2d";
import { buildStandardField } from "./field";
import { driveMenu, readMenuFrame } from "./input";
import { CaromState, gameOf } from "./state";

export class TitleMode extends GameMode {
  declare readonly state: CaromState;

  gameStateClass = CaromState;
  playerControllerClass = MenuController;
  pawnClass = null;

  beginPlay(): void {
    // One seat: every menu on this level answers to either side's keys, so
    // one controller reads them all.
    this.addPlayer({ name: "MENU" });
    buildStandardField(this.world);
    this.state.screen = "title";
    this.state.menuIndex = 0;
  }

  /**
   * One frame's input, routed by the screen it arrives on. Called by the menu
   * controller at the top of the frame, once, with its own reader — the engine
   * consumes an edge per controller on first read, so a single reader per frame
   * is what keeps one press meaning one thing.
   */
  handleInput(input: InputReader): void {
    const game = gameOf(this.world);
    if (game.frozen) return;

    // Mute works on every screen, so it is read before the per-screen switch.
    if (input.pressed("mute")) {
      this.world.audio.setMuted(!this.world.audio.muted());
    }

    const state = this.state;
    if (state.screen === "howto") {
      // `confirm` and `back` both leave; read both so neither is left armed.
      const frame = readMenuFrame(input, state.screen, game.pressOrigins);
      const left = input.pressed("back");
      if (left) {
        game.goToTitle(game.titleIndex);
        return;
      }
      driveMenu(state, frame, () => {
        game.goToTitle(game.titleIndex);
      });
      return;
    }
    if (state.screen !== "title") return;

    driveMenu(
      state,
      readMenuFrame(input, state.screen, game.pressOrigins),
      (index) => {
        this.select(index);
      },
    );
  }

  /**
   * Confirming a title item. Each of the three remembers itself as
   * `titleIndex`, which is the selection every path back to the title restores
   * (specs/ui.md).
   */
  private select(index: number): void {
    const game = gameOf(this.world);
    game.titleIndex = index;
    if (index === 0) {
      game.startMatch("solo");
      return;
    }
    if (index === 1) {
      game.startMatch("versus");
      return;
    }
    this.state.screen = "howto";
    this.state.menuIndex = 0;
  }
}

/** The title level's one seat: it routes the menu input and drives nothing. */
export class MenuController extends PlayerController {
  tick(): void {
    const mode = this.world.mode;
    if (mode instanceof TitleMode) mode.handleInput(this.input);
  }
}
