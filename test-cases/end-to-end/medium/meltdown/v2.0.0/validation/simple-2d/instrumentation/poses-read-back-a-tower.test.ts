// instrumentation/poses-read-back-a-tower — a tower's heat, level, freshness, trip,
// trip timer and two faculty gates read back as they were posed.
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
// THE WHOLE READING IS TAKEN FROM THE POSE ITSELF, before any frame runs.
// `snapshot` is a pure read of the state (specs/instrumentation.md), so a pose is
// readable the moment it is made. Reading at the pose is what makes this a check
// of the OPERATION rather than of what a frame did to its result.
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
  poseTower,
  startRun,
  towerOf,
  type Harness,
} from "../harness";
import { GUN } from "./scenes";

/** The tower figures posed, each off the value `addTower` starts a tower at. */
const TOWER = {
  heat: 63,
  level: 2,
  tripTimer: 3.5,
} as const;

/**
 * How close a posed number must read back, as decimal places.
 *
 * Six places is `5e-7`. A pose is an assignment rather than an integration:
 * nothing between the call and the read may change the value at all, so the only
 * slack a conforming build can need is the representation of the literal itself.
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
  const id = poseTower(h, "arc", GUN.col, GUN.row);

  h.debug.setTowerHeat(id, TOWER.heat);
  h.debug.setTowerLevel(id, TOWER.level);
  h.debug.setTowerFresh(id, false);
  h.debug.setTowerTripped(id, true);
  h.debug.setTowerTripTimer(id, TOWER.tripTimer);
  h.debug.setTowerFiring(id, false);
  h.debug.setTowerThermal(id, false);

  const tower = towerOf(h.snapshot(), id);
  assertCloseTo(tower.heat, TOWER.heat, READBACK_DIGITS, "setTowerHeat");
  assertEqual(tower.level, TOWER.level, "setTowerLevel");
  assertEqual(tower.fresh, false, "setTowerFresh");
  assertEqual(tower.tripped, true, "setTowerTripped");
  assertCloseTo(
    tower.tripTimer,
    TOWER.tripTimer,
    READBACK_DIGITS,
    "setTowerTripTimer",
  );
  assertEqual(tower.firingEnabled, false, "setTowerFiring");
  assertEqual(tower.thermalEnabled, false, "setTowerThermal");

  h.debug.setSelected(id);
  await h.advance(1);
  captureStill(h, "posed");

  // And each of the five booleans reads back the other way, so none of them is a
  // field reported as a constant.
  h.debug.setTowerFresh(id, true);
  h.debug.setTowerTripped(id, false);
  h.debug.setTowerTripTimer(id, TRIP_TIME);
  h.debug.setTowerFiring(id, true);
  h.debug.setTowerThermal(id, true);
  const back = towerOf(h.snapshot(), id);
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
