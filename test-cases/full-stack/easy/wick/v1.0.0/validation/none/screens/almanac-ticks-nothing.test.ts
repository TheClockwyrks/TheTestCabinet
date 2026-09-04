// screens/almanac-ticks-nothing — the almanac advances nothing.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("What advances on each screen"),
// the row "`title`, `howto`, `almanac` | Nothing." specs/ui.md ("`almanac`")
// says it again with the run it holds: "The almanac holds the idle run, nothing
// advances while it is open, and no cue loops on it." specs/state.md fixes what
// the idle run is: "tick `0`, level `1`, no experience, no kills, the
// lamplighter at the world origin facing right with `BASE_MAX_HP` (`100`)
// health, no weapons, no passives, nothing alive, nothing dropped, no offers, no
// level-ups earned, no chest result, the spawn timer at `0`, no events fired,
// and the next id `0`", which `idleRun()` restates with the derived fields each
// formula gives an empty loadout.
//
// WHY THE WORLD IS POSED AS IT IS. The almanac is entered through
// `setScreen("almanac")`, which specs/instrumentation.md gives "the idle run",
// and sixty frames are then run with no key pressed at all. Sixty is a second of
// the build's loop: long enough that a build that consumed a tick per frame
// would have consumed sixty, and a build that consumed one every few frames at
// least one. The clock is read on EVERY frame rather than only at the end, so a
// build that advanced and then reset is caught where it advanced.
//
// THE TOLERANCE. None: a tick count is a whole number and the idle run's figures
// are exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { TICK_HZ } from "../constants";
import {
  captureStill,
  createHarness,
  documentedRun,
  idleRun,
  type Harness,
} from "../harness";
import { openAlmanac } from "./almanac";

/** One second of the almanac, read a frame at a time. */
const ALMANAC_FRAMES = TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds run.tick at 0 and the idle run across sixty frames of almanac", async () => {
  const opened = await openAlmanac(h);
  assertEqual(opened.run.tick, 0, "the run clock the almanac is entered with");

  for (let frame = 1; frame <= ALMANAC_FRAMES; frame += 1) {
    const snapshot = await h.step(1);
    assertEqual(
      snapshot.screen,
      "almanac",
      `the screen on almanac frame ${frame}, which nothing here leaves`,
    );
    assertEqual(
      snapshot.run.tick,
      0,
      `the run clock on almanac frame ${frame} (specs/ui.md)`,
    );
  }

  const after = await h.snapshot();
  await captureStill(h, "still");
  assertDeepEqual(
    documentedRun(after.run),
    idleRun(),
    "the run the almanac held across sixty frames",
  );
});
