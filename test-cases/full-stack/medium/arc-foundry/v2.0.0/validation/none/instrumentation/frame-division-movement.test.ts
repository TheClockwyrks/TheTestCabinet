// instrumentation/frame-division-movement — a unit walks the same second however
// it was divided into frames.
//
// `specs/instrumentation.md` states the step as a property of the interval
// rather than of the frame: "an interval of simulation time reaches the same
// state however it was divided into frames and whatever frame rate produced it".
// So the same second is covered twice, once as a single frame and once as sixty,
// and where the two leave a walking unit is compared.
//
// WHAT A FAILURE HERE MEANS. A build that moves a unit a fixed step per frame, or
// that reads the wall clock inside its update, plays at a different speed on every
// machine and cannot be graded at all: every duration this project measures would
// be measuring the host. The tolerance is the item's own — a logical unit on a
// body travelling sixty of them a second — because a change in step size explains
// a little drift and nothing more.
//
// TRAVEL ALONE. A unit walks its route under the pathfinder; the projectile
// integration is a second, separate faculty a build can get right or wrong on its
// own, and `instrumentation/frame-division-projectile` decides that one.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertLessThan } from "../assert";
import {
  ConstantClock,
  captureReplay,
  createHarness,
  distance,
  openYard,
  type Harness,
} from "../harness";

/** The interval this comparison covers, and its two divisions. */
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

afterEach(async () => {
  await coarse.dispose();
  await fine.dispose();
});

it("covers a second in one frame and in sixty, and reaches the same place", async () => {
  // One walking unit on an otherwise empty yard: nothing fires at it, nothing
  // stands in its way, and its travel is the only thing moving.
  for (const h of [coarse, fine]) {
    await openYard(h, { wave: 1 });
    await h.debug.spawnUnit("mote");
  }

  const before = {
    coarse: await coarse.snapshot(),
    fine: await fine.snapshot(),
  };

  await coarse.advance(1);
  await captureReplay(fine, "drive", () => fine.advance(FINE_FRAMES));

  const after = {
    coarse: await coarse.snapshot(),
    fine: await fine.snapshot(),
  };

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
