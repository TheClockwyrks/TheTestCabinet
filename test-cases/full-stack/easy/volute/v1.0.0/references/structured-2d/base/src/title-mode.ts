// Volute — the title level's mode.
//
// The title is the same hall, standing still behind its front door: the same
// bodies, the same state class, and the same rules object, opened on the `title`
// screen instead of on a level. Sharing `HallMode` is what makes the title's
// figures exactly the title-screen values `specs/state.md` fixes — score `0`,
// level `1`, `CELLS` cells, level 1's full quota, pressure `0`, chain step `1`,
// no machinery, an empty channel — and what makes every debug pose behave the
// same whichever level is open.

import { HallMode } from "./hall-mode";

/** The front door. It runs no simulation: the `title` screen advances nothing. */
export class TitleMode extends HallMode {
  override beginPlay(): void {
    super.beginPlay();
    this.state.screen = "title";
  }
}
