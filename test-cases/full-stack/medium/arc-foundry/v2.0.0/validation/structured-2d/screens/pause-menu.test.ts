// Arc Foundry — `screens.pause-menu`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `screens/pause-menu.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. Opening the pause menu moves the screen to paused, freezes
// the simulation, and draws RESUME, RESTART and QUIT TO MENU over a yard that
// is still visible behind them.
//
// HOW IT IS DECIDED. Open the pause menu mid-wave, read the text draws, and
// compare simTime across ten seconds. The evidence it hands back is `pause`
// (image): the pause menu over the frozen yard.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("screens.pause-menu", () => {
  it("The pause menu covers a frozen yard", () => {
    fail(
      "a validator deciding this point",
      "the suite for `screens.pause-menu` has not been written yet",
    );
  });
});
