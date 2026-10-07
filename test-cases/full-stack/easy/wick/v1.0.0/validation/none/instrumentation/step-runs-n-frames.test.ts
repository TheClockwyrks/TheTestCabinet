// Wick — instrumentation/step-runs-n-frames: `step(5)` on `playing` with a
// level-up queued runs one tick that opens the overlay and then four frames on
// `levelup`, so `run.tick` rises by 1 and `simTime` by `5 × TICK_DT`.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `step(ticks)`):
// "Runs `ticks` frames of the build's loop immediately and in order, whatever
// the screen"; "A frame whose tick opens an overlay or ends the run is followed
// by the remaining frames on the screen it opened, so `step(n)` always runs `n`
// frames"; "`simTime` rises by `TICK_DT` per frame on every screen".
// specs/progression.md: "A `playing` tick that ends with `pendingLevelUps`
// above `0` runs to completion and then opens the overlay".
//
// WHY THE WORLD IS POSED AS IT IS. The build's own `step(5)` is called
// directly, since the harness's drive runs frames one at a time and the point
// is about the count the build honours in one call. A queued level-up makes
// the first tick leave `playing`, so a build that stopped at the screen change
// adds one frame's `simTime` rather than five. The call is bracketed inside the
// page, because the same document leaves the build's own loop running in real
// time while the clock is held and has `simTime` rise by the delta of every
// frame it runs, so a reading taken across two crossings would count those
// frames too.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { TICK_DT, TIMER_TOL } from "../constants";
import {
  bracket,
  captureStill,
  createHarness,
  isolate,
  type Harness,
} from "../harness";

const FRAMES = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("runs all five frames across the overlay the first tick opens", async () => {
  await isolate(h);
  await h.debug.setPendingLevelUps(1);

  const { before, after } = await bracket(h, "step", [FRAMES]);
  await captureStill(h, "five");

  assertEqual(before.screen, "playing", "the screen the five frames start on");

  assertEqual(after.screen, "levelup", "the screen the first tick opened");
  assertEqual(after.run.tick - before.run.tick, 1, "ticks the five frames ran");
  assertNear(
    after.simTime - before.simTime,
    FRAMES * TICK_DT,
    TIMER_TOL,
    "simTime five frames added",
  );
});
