// instrumentation/start-run-sets-the-counters — the figures a run opens on.
//
// THE RULE. "`startRun()` | Runs the game's run-start sequence of
// `specs/simulation.md`: ... `sim.cycle` at `0`, `sim.fraction` at `0`,
// `sim.speed` at `DEFAULT_SPEED_INDEX` (`1`), every set's tally at `0`,
// `sim.fault` `null`, and `sim.status` `running`"
// (`specs/instrumentation.md`, The run).
//
// SIX READINGS, ONE PER FIGURE, taken off the snapshot the moment the call
// returns. `sim` itself is the seventh: it is `null` while editing
// (`specs/instrumentation.md`, Snapshot shape), so a run that opened at all is
// what the readings are taken through. `tallies` carries "one entry per product",
// so a challenge with two products opens on two zeroes rather than on one.
//
// `sim.fraction` IS NEVER READ FOR EQUALITY, `0` included. It is one of "the three
// figures carried as running sums of the frames' own delta times", which "agree to
// within the rounding of that sum rather than bit for bit"
// (`specs/instrumentation.md`, A render-free core), so every read of it goes
// through the case's own `FRACTION_TOLERANCE`.
//
// THE WORLD IS POSED, NOT SEARCHED. A posed challenge with two products, an empty
// machine, and the completion switch held off. No part is placed and no frame is
// advanced, so nothing has had the chance to move a counter off the value
// `startRun` set it to.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNear,
  assertNotNull,
  assertNull,
} from "../assert";
import { DEFAULT_SPEED_INDEX, FRACTION_TOLERANCE } from "../constants";
import {
  captureStill,
  createHarness,
  holdCompletion,
  openChallengeDocument,
  type Harness,
} from "../harness";
import { TWO_AND_TWO } from "../fixtures";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the run running, with no fault and every counter at its opening value", async () => {
  await openChallengeDocument(h, TWO_AND_TWO);
  await h.debug.clearMachine();
  await holdCompletion(h);

  await h.debug.startRun();
  const opened = await h.snapshot();

  await h.advance(1);
  await captureStill(h, "counters");

  assertNotNull(opened.sim, "startRun opens a run, so sim is no longer null");
  assertEqual(
    opened.sim?.status,
    "running",
    "startRun leaves sim.status running",
  );
  assertNull(opened.sim?.fault, "startRun leaves sim.fault null");
  assertEqual(opened.sim?.cycle, 0, "startRun leaves sim.cycle at 0");
  assertNear(
    opened.sim?.fraction ?? -1,
    0,
    FRACTION_TOLERANCE,
    "startRun leaves sim.fraction at 0",
  );
  assertEqual(
    opened.sim?.speed,
    DEFAULT_SPEED_INDEX,
    "startRun leaves sim.speed at DEFAULT_SPEED_INDEX",
  );
  assertDeepEqual(
    opened.sim?.tallies,
    TWO_AND_TWO.products.map(() => 0),
    "startRun leaves every set's tally at 0, one entry per product",
  );
});
