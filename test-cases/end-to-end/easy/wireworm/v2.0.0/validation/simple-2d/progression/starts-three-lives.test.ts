// progression/starts-three-lives — a new run opens with START_LIVES lives.
//
// THE RULE. `specs/progression.md`, *Starting a run*: a new run opens on the
// `playing` screen with Lives at `START_LIVES` (`3`). `specs/ui.md` says which
// item opens it — `DESCEND`, the first entry of the title menu, taken by
// `confirm`.
//
// HOW THE POSE MAKES THE READING MEAN SOMETHING. A build that has never run
// anything is already sitting at three lives, so confirming DESCEND on a fresh
// harness would read `3` whether or not opening a run sets the count at all. The
// title is therefore posed carrying a STALE count first, and the reading is that
// DESCEND put the run back to `START_LIVES`. Every wrong model then reads a
// different number: a build that carries the count over reads the stale figure, a
// build that spends one on the way in reads one below it, and a build that never
// leaves the title reads it unchanged.
//
// The menu index is posed at `0` as well, so what `confirm` takes is DESCEND
// whatever the build left highlighted; which item the highlight rests on is
// `screens.title-screen`'s point, not this one.

import { afterEach, beforeEach, it } from "vitest";
import { START_LIVES } from "../../src/constants";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

/**
 * The stale count the title is posed with: a figure no correct opening can leave
 * behind, and far enough from `START_LIVES` (`3`) that a build which merely
 * decremented it could not land on the answer.
 */
const STALE_LIVES = 1;

/** The first entry of `TITLE_ITEMS`, which is `DESCEND` (specs/ui.md). */
const DESCEND = 0;

/** A key bound to `confirm` in `BINDINGS` (specs/controls.md). */
const CONFIRM_KEY = "Enter";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("opens a run reporting START_LIVES lives", async () => {
  const { debug } = harness;
  debug.setScreen("title");
  debug.setMenuIndex(DESCEND);
  debug.setLives(STALE_LIVES);

  // `tap` runs the one frame that delivers the key's edge, so the run is open and
  // its first frame is on the canvas by the time this returns.
  await harness.tap(CONFIRM_KEY);

  captureStill(harness, "opening");
  assertEqual(harness.snapshot().lives, START_LIVES);
});
