// screens/pause-quit — confirming QUIT TO MENU leaves the run and returns to the
// title.
//
// THE RULE. specs/screens.md's `paused` table: the `QUIT TO MENU` row leads to
// `title`.
//
// THE THIRD ROW, AND THE ONE THAT LEAVES THE RUN. The other two rows of
// `PAUSE_ITEMS` both keep the player in the game — `screens.pause-resume` returns
// to the match and `screens.pause-restart` replays it — so this is the only row
// that has to abandon it, and it is the row a player reaches for when they have
// finished. A build that answers it by resuming, or by replaying, keeps a player
// in a run they asked to leave, and reads `playing` here.
//
// THE PAUSE SCREEN IS POSED OVER A REAL RUN. `startRun` opens an empty, quiet
// floor and the screen is set on top of it, so the press is made from where a
// player would make it. `setScreen` runs no entry effect
// (specs/instrumentation.md), so what is graded is the row alone; how a player
// reaches the pause screen is `controls.esc-pauses` and `controls.pause-key`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, PAUSE_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { poseMenu } from "./menu";

/** The key specs/controls.md binds `confirm` to. */
const CONFIRM = BINDINGS.confirm[0];

/** The row `QUIT TO MENU` sits on, last of the three `PAUSE_ITEMS`. */
const QUIT_ROW = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title when QUIT TO MENU is confirmed", async () => {
  assertEqual(
    PAUSE_ITEMS[QUIT_ROW],
    "QUIT TO MENU",
    "posing: the row this item is about (specs/screens.md, PAUSE_ITEMS)",
  );
  poseMenu(h, "paused", QUIT_ROW);
  await h.advance(1);
  assertEqual(
    h.snapshot().screen,
    "paused",
    "posing: the screen the press is made on (specs/screens.md)",
  );

  await h.tap(CONFIRM);
  captureStill(h, "title");

  assertEqual(
    h.snapshot().screen,
    "title",
    `${CONFIRM} on the QUIT TO MENU row: the screen it leads to ` +
      `(specs/screens.md)`,
  );
});
