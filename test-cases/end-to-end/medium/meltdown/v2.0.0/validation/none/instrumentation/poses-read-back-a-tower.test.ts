// Meltdown — instrumentation/poses-read-back-a-tower — a tower's heat, level, freshness,
// trip, trip timer and two faculty gates read back as they were posed.
//
// WHY THIS IS A POINT. `specs/instrumentation.md` says the snapshot carries every
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
// point of its own. Every value below is read back on the same frame it was posed,
// before anything has had a chance to run.
//
// EVERY POSED VALUE IS DISTINGUISHING. No two fields carry the same number and none
// of them carries a default, so a build that reports one field where another was
// posed, or that reports a constant, reads as the wrong number rather than
// coincidentally right.
//
// AND EVERY BOOLEAN READS BACK BOTH WAYS, so none of the five is a field a build
// reports as a constant. The trip timer is re-posed to `TRIP_TIME` on the second
// reading for the same reason.
//
// NOTHING RUNS BETWEEN THE POSE AND THE READ. A tower posed at heat runs its
// thermal model and a posed trip timer counts down, so the whole reading is taken
// with no frame advanced — which is what makes it a check of the OPERATION rather
// than of what a frame did to its result.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import { TRIP_TIME } from "../constants";
import { freeSite } from "../fixtures";
import {
  captureStill,
  createHarness,
  poseTower,
  requireTower,
  startRun,
  type Harness,
} from "../harness";

/** Distinguishing values: none of them a figure `addTower` starts a tower at. */
const POSED = {
  heat: 63.5,
  level: 3,
  tripTimer: 2.75,
} as const;

/**
 * How close a posed float must read back, in decimal places for
 * {@link assertCloseTo}: within `5e-7`.
 *
 * A pose is a write and a read of one number, so the only difference a conformant
 * build can introduce is the float's own representation. This is not a tolerance
 * on behaviour; nothing here runs a rule.
 */
const EXACT = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports a tower's posed heat, level, freshness, trip and faculty gates", async () => {
  await startRun(h);
  const site = freeSite(0);
  const id = await poseTower(h, "lance", site.col, site.row);

  await h.debug.setTowerHeat(id, POSED.heat);
  await h.debug.setTowerLevel(id, POSED.level);
  await h.debug.setTowerFresh(id, false);
  await h.debug.setTowerTripped(id, true);
  await h.debug.setTowerTripTimer(id, POSED.tripTimer);
  await h.debug.setTowerFiring(id, false);
  await h.debug.setTowerThermal(id, false);

  const posed = requireTower(await h.snapshot(), id, "the posed Lance");
  assertCloseTo(posed.heat, POSED.heat, EXACT, "setTowerHeat");
  assertEqual(posed.level, POSED.level, "setTowerLevel");
  assertEqual(posed.fresh, false, "setTowerFresh(false)");
  assertEqual(posed.tripped, true, "setTowerTripped(true)");
  assertCloseTo(posed.tripTimer, POSED.tripTimer, EXACT, "setTowerTripTimer");
  assertEqual(posed.firingEnabled, false, "setTowerFiring(false)");
  assertEqual(posed.thermalEnabled, false, "setTowerThermal(false)");

  await h.debug.setSelected(id);
  await h.advance(1);
  await captureStill(h, "posed");

  // And each of the five booleans reads back the other way, so none of them is a
  // field reported as a constant.
  await h.debug.setTowerFresh(id, true);
  await h.debug.setTowerTripped(id, false);
  await h.debug.setTowerTripTimer(id, TRIP_TIME);
  await h.debug.setTowerFiring(id, true);
  await h.debug.setTowerThermal(id, true);
  const back = requireTower(await h.snapshot(), id, "the posed Lance");
  assertEqual(back.fresh, true, "setTowerFresh(true)");
  assertEqual(back.tripped, false, "setTowerTripped(false)");
  assertCloseTo(back.tripTimer, TRIP_TIME, EXACT, "setTowerTripTimer again");
  assertEqual(back.firingEnabled, true, "setTowerFiring(true)");
  assertEqual(back.thermalEnabled, true, "setTowerThermal(true)");
});
