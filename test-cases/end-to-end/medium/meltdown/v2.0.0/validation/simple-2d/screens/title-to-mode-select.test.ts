// screens/title-to-mode-select — confirming PLAY opens mode select, and starts no
// game of its own.
//
// THE RULE. specs/screens.md's `title` table: the `PLAY` row leads to
// `modeselect`, and "It starts no game of its own." specs/controls.md binds
// `confirm` to `Enter` and gives it the effect "Takes the highlighted row."
//
// BOTH HALVES ARE READ, because the row has two ways to be wrong and they are
// different failures. A build that leaves the screen where it is has not answered
// the row at all; a build that starts a run on the mode and difficulty it happens
// to hold has answered the wrong row, and would strand a player who wanted any of
// the other four modes. The screen after the press is therefore read for the
// destination AND for the run not having begun.
//
// POSED ON THE ROW, NOT WALKED TO IT. `PLAY` is the first row, which is where
// `reset` leaves the highlight, but the row is posed outright all the same so the
// precondition rests on the pose rather than on `reset` being right — which is
// `instrumentation.reset-restores-the-title`'s requirement, not this one's.
//
// THE PRESS IS A REAL KEY. It goes to the engine's own input at the binding
// `src/constants.ts` declares, so what answers it is the build's own handling of
// `confirm` rather than an operation of the debug surface.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, TITLE_ITEMS } from "../../src/constants";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { poseMenu } from "./menu";

/** The key specs/controls.md binds `confirm` to. */
const CONFIRM = BINDINGS.confirm[0];

/** The row `PLAY` sits on, first of the two `TITLE_ITEMS`. */
const PLAY_ROW = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens mode select when PLAY is confirmed, without starting a game", async () => {
  assertEqual(
    TITLE_ITEMS[PLAY_ROW],
    "PLAY",
    "posing: the row this item is about (specs/screens.md, TITLE_ITEMS)",
  );
  poseMenu(h, "title", PLAY_ROW);
  await h.advance(1);
  assertEqual(
    h.snapshot().screen,
    "title",
    "posing: the screen the press is made on (specs/screens.md)",
  );

  await h.tap(CONFIRM);
  captureStill(h, "modeselect");

  const after = h.snapshot();
  assertEqual(
    after.screen,
    "modeselect",
    `${CONFIRM} on the PLAY row: the screen it leads to (specs/screens.md)`,
  );
  assertEqual(
    after.surge.length,
    0,
    "PLAY starts no game of its own, so no surge has been released " +
      "(specs/screens.md)",
  );
});
