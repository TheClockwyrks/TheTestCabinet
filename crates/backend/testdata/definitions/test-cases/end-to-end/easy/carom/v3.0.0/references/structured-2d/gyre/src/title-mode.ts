// Carom — the title level: its game mode and the controller that reads its
// menus.
//
// The title level possesses nothing (`pawnClass` is null): its one player
// controller exists to be the seat input reaches the game through, and its tick
// hands the frame to the mode. Reading input FIRST, from a controller —
// controllers tick before any actor — is what specs/ui.md means by "each update
// reads input first": the screen the frame's edges leave the game on is the
// screen everything after them advances.
//
// The rules themselves — the menus, the keyboard, the pointer, and what
// confirming an item does — are `CaromMode`'s, shared with the match level, so
// the title and the pause menu answer a mouse and a finger identically.

import { PlayerController } from "@clockwyrks/structured-2d";
import { CaromMode } from "./carom-mode";

export class TitleMode extends CaromMode {
  playerControllerClass = MenuController;
  pawnClass = null;

  beginPlay(): void {
    // One seat: every menu on this level answers to either side's keys, so one
    // controller reads them all. The engine consumes an edge per controller on
    // first read, so a single reader per frame is what keeps one press meaning
    // one thing.
    this.addPlayer({ name: "MENU" });
  }
}

/** The title level's one seat: it routes the frame and drives nothing. */
export class MenuController extends PlayerController {
  tick(dt: number): void {
    const mode = this.world.mode;
    if (mode instanceof TitleMode) mode.beginFrame(dt, this.input);
  }
}
