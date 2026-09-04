// Meltdown — instrumentation/poses-read-back-a-tower — a tower's heat, level, freshness,
// trip, trip timer and two faculty gates read back as they were posed.
//
// WHY THIS IS A POINT. specs/instrumentation.md says the snapshot carries every
// field an operation can set, "so every operation is verifiable by setting a value
// and reading it back". That round trip is what every other group in this suite
// stands on: a check poses a heat of 60 and then asserts what one second of
// cooling did to it, and if the pose never landed the check is measuring something
// it did not arrange. A pose that silently does nothing, or that lands on a field
// the snapshot does not report, is caught here and nowhere else.
//
// ONE GROUP OF STATE, BECAUSE EACH POSE IS INDEPENDENTLY BREAKABLE. A build whose
// only broken pose is `setUnitSlow` must lose one point rather than every pose it
// got right, so the surface's poses are read as six items —
// `instrumentation.poses-read-back-the-run`, `-the-figures`, `-the-build`,
// `-a-tower`, `-a-unit` and `-the-pointer-and-the-gate` — and this one reads
// the seven poses that arrange ONE TOWER.
//
// WHAT IS ASSERTED. That the value POSED comes back. Not what the game does with
// it afterwards, and not that a rule fired: `setLives` triggers no game over,
// `setScore` pays no bonus, `setScreen` runs no entry effect — each of those is a
// point of its own.
//
// THE READING IS TAKEN FROM THE POSE ITSELF, before any frame runs. `snapshot` is
// a pure read of the state (specs/instrumentation.md), so a pose is readable the
// moment it is made — which is what makes this a check of the OPERATION rather
// than of what a frame did to its result.
//
// EVERY POSED VALUE IS DISTINGUISHING. No two fields carry the same number and none
// of them carries a default, so a build that reports one field where another was
// posed, or that reports a constant, reads as the wrong number rather than
// coincidentally right.
//
// AND EVERY BOOLEAN READS BACK BOTH WAYS, so none of the five is a field a build
// reports as a constant. The trip timer is re-posed to `TRIP_TIME` on the second
// reading for the same reason.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import { TRIP_TIME } from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { quietSite, readTower } from "./ground";

/** The tower figures posed. */
const HEAT = 63;
const LEVEL = 2;
const TRIP_TIMER = 3.5;

/**
 * How far a read-back figure may sit from the figure posed, in the unit of the
 * figure.
 *
 * The reading is taken with no frame advanced, so nothing has run between the pose
 * and it and the only difference a conformant build can introduce is the float it
 * stored the number in. Six decimal places is many orders of magnitude above that
 * and many orders below the smallest step any of these figures takes.
 */
const READBACK_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports a tower's posed heat, level, freshness, trip and faculty gates", async () => {
  startRun(h);
  const site = quietSite(0);
  h.debug.addTower("arc", site.col, site.row, 0);
  const towers = h.snapshot().towers;
  assertEqual(towers.length, 1, "the towers addTower left on the floor");
  const towerId = towers[towers.length - 1].id;

  h.debug.setTowerHeat(towerId, HEAT);
  h.debug.setTowerLevel(towerId, LEVEL);
  h.debug.setTowerFresh(towerId, false);
  h.debug.setTowerTripped(towerId, true);
  h.debug.setTowerTripTimer(towerId, TRIP_TIMER);
  h.debug.setTowerFiring(towerId, false);
  h.debug.setTowerThermal(towerId, false);

  const tower = readTower(h.snapshot(), towerId, "the posed tower");
  assertCloseTo(tower.heat, HEAT, READBACK_DIGITS, "setTowerHeat");
  assertEqual(tower.level, LEVEL, "setTowerLevel");
  assertEqual(tower.fresh, false, "setTowerFresh");
  assertEqual(tower.tripped, true, "setTowerTripped");
  assertCloseTo(
    tower.tripTimer,
    TRIP_TIMER,
    READBACK_DIGITS,
    "setTowerTripTimer",
  );
  assertEqual(tower.firingEnabled, false, "setTowerFiring");
  assertEqual(tower.thermalEnabled, false, "setTowerThermal");

  h.debug.setSelected(towerId);
  await h.advance(1);
  captureStill(h, "posed");

  // And each of the five booleans reads back the other way, so none of them is a
  // field reported as a constant.
  h.debug.setTowerFresh(towerId, true);
  h.debug.setTowerTripped(towerId, false);
  h.debug.setTowerTripTimer(towerId, TRIP_TIME);
  h.debug.setTowerFiring(towerId, true);
  h.debug.setTowerThermal(towerId, true);
  const back = readTower(h.snapshot(), towerId, "the posed tower");
  assertEqual(back.fresh, true, "setTowerFresh(true)");
  assertEqual(back.tripped, false, "setTowerTripped(false)");
  assertCloseTo(
    back.tripTimer,
    TRIP_TIME,
    READBACK_DIGITS,
    "setTowerTripTimer again",
  );
  assertEqual(back.firingEnabled, true, "setTowerFiring(true)");
  assertEqual(back.thermalEnabled, true, "setTowerThermal(true)");
});
