// instrumentation/frame-division-movement — a unit walks the same second however
// the second is divided into frames.
//
// `specs/instrumentation.md` states it as a property of the interval rather than
// of the frame: an interval of simulation time reaches the same state however it
// was divided into frames. So the same second is covered twice, once as a single
// frame and once as sixty, and where the two leave a walking unit is compared.
//
// UNDER THIS ENGINE THE FRAME IS THE CLOCK'S. The engine owns the loop and the
// surface carries no clock operation, so the division is chosen by handing each
// harness a `ConstantClock` of its own. Nothing about the build is told which
// division it is running under.
//
// WHAT A FAILURE HERE MEANS. A build that moves a unit a fixed step per frame, or
// that reads the wall clock inside its update, plays at a different speed on every
// machine and cannot be graded at all: every duration this project measures would
// be measuring the host. The tolerance is the item's own — a logical unit on a body
// travelling sixty of them a second — because a change in step size explains a
// little drift and nothing more.
//
// TRAVEL AND FLIGHT ARE TWO INTEGRATIONS, AND TWO POINTS. A build can integrate a
// unit's walk and step a projectile, so a projectile's flight is decided by
// `instrumentation/frame-division-projectile` rather than folded in here.

import { ConstantClock } from "@test-cabinet/simple-2d";
import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertLessThan } from "../assert";
import {
  captureReplay,
  createHarness,
  distance,
  openYard,
  type Harness,
} from "../harness";

/** The seed both halves of the comparison run under. */
const SEED = 3;

/** The interval the comparison covers, and its two divisions. */
const SECOND_MS = 1000;
const FINE_FRAMES = 60;

/** The tolerance the item states: one logical unit. */
const TOLERANCE = 1;

let coarse: Harness;
let fine: Harness;

beforeEach(async () => {
  // One frame a second, and sixty. Both harnesses drive the same build the same
  // way; the size of a frame is the only thing that differs between them.
  coarse = await createHarness({ clock: new ConstantClock(SECOND_MS) });
  fine = await createHarness({
    clock: new ConstantClock(SECOND_MS / FINE_FRAMES),
  });
});

afterEach(() => {
  coarse?.dispose();
  fine?.dispose();
});

it("covers a second in one frame and in sixty, and reaches the same place", async () => {
  // One walking unit on an otherwise empty yard: nothing fires at it, nothing
  // stands in its way, and its travel is the only thing moving.
  for (const h of [coarse, fine]) {
    openYard(h, { seed: SEED, wave: 1 });
    h.debug.spawnUnit("mote");
  }

  const before = { coarse: coarse.snapshot(), fine: fine.snapshot() };

  await coarse.advance(1);
  await captureReplay(fine, "drive", () => fine.advance(FINE_FRAMES));

  const after = { coarse: coarse.snapshot(), fine: fine.snapshot() };

  // The clock moved by the second it was handed, either way.
  assertCloseTo(
    after.coarse.simTime - before.coarse.simTime,
    1,
    6,
    "the simulation clock over one second covered as a single frame",
  );
  assertCloseTo(
    after.fine.simTime - before.fine.simTime,
    1,
    6,
    `the simulation clock over one second covered as ${FINE_FRAMES} frames`,
  );

  // And the unit is in the same place.
  const walkedCoarse = after.coarse.units[0];
  const walkedFine = after.fine.units[0];
  assertEqual(
    walkedCoarse === undefined || walkedFine === undefined,
    false,
    "the released unit still on the yard after the second both halves covered",
  );
  assertLessThan(
    distance(walkedCoarse!, walkedFine!),
    TOLERANCE,
    `the distance between where one frame of a second left the unit ` +
      `(${walkedCoarse!.x.toFixed(2)}, ${walkedCoarse!.y.toFixed(2)}) and ` +
      `where ${FINE_FRAMES} frames of it left the unit ` +
      `(${walkedFine!.x.toFixed(2)}, ${walkedFine!.y.toFixed(2)})`,
  );
});
