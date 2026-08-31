// Meltdown — instrumentation/unit-motion-gate: `setUnitMotion(id, false)` holds one
// unit where it stands, and turning it back on lets it walk.
//
// THE RULE. `specs/instrumentation.md`: "`motion` gates the unit's locomotion,
// which is whether it advances along its route or its flight line, and nothing
// else. Off, the unit holds its position."
//
// WHY EVERY TARGETING READING IN THIS PROJECT DEPENDS ON IT. `poseTarget` — the
// atom under every range, damage, splash and slow scenario — is exactly this gate
// turned off, because a target that walked would leave the range being measured
// part way through the measurement. A build whose gate does nothing turns each of
// those checks into a race between the fire clock and a Mote's sixty units a
// second, and the failures land on `combat/*` rather than here.
//
// A CONTRAST OVER THE SAME SECOND, because a held unit and a unit that never had
// any locomotion look identical in one reading. The gate off must leave the centre
// where it was; the gate on must move it. Both legs pose the SAME unit at the SAME
// point on the open left corridor, so the only difference between them is the gate.
//
// THE POSITION IS POSED RATHER THAN TAKEN FROM THE ENTRY, so the two legs open at
// the identical point by construction and the reading is a displacement rather
// than a comparison of two entries. It is posed on the straight corridor
// (`specs/floor.md`), where a walking Mote's route holds no corner, so the moving
// leg has nothing but distance in it.
//
// WHAT THIS DOES NOT DECIDE. How fast a Mote walks: `surge/walks-at-its-speed` owns
// that figure, and the floor the moving leg is held to is a quarter of it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { tileCX, tileCY } from "../constants";
import { laneTile } from "../fixtures";
import {
  captureStill,
  createHarness,
  distance,
  framesFor,
  poseWalker,
  requireUnit,
  startRun,
  type Harness,
} from "../harness";

/** The unit read, and the span each leg is driven over. */
const UNIT = "mote";
const SPAN_SECONDS = 1;

/** Where on the left corridor the unit is posed, in tiles from the vent's edge. */
const START_ALONG = 3;

/**
 * How far a held unit may drift, in logical stage units.
 *
 * A two-hundredth of a tile. "Holds its position" is a value carried unchanged
 * across a hundred and twenty frames, so a conformant build writes back the same
 * float and needs none of this; what the bound excludes is any locomotion at all,
 * since the slowest thing on the roster covers thirty units in the same second
 * (`specs/surge.md`).
 */
const HELD_TOLERANCE = 0.1;

/**
 * How far the walking unit must travel, in logical stage units.
 *
 * A quarter of the sixty units a Mote covers in a second (`specs/surge.md`). This
 * decides only that the leg moved; the speed itself is `surge/*`'s item.
 */
const MIN_TRAVEL = 15;

let h: Harness;

/** Pose one Mote at a fixed point on the open left corridor, and hand back its id. */
async function poseTheWalker(): Promise<number> {
  await startRun(h);
  const id = await poseWalker(h, UNIT, "left");
  const at = laneTile("left", START_ALONG);
  await h.debug.setUnitPosition(id, tileCX(at.col), tileCY(at.row));
  return id;
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the unit where it stands with the gate off", async () => {
  const id = await poseTheWalker();
  await h.debug.setUnitMotion(id, false);
  const opened = requireUnit(await h.snapshot(), id, "the held Mote");

  await h.advance(framesFor(SPAN_SECONDS));
  await captureStill(h, "held");

  const closed = requireUnit(await h.snapshot(), id, "the held Mote");
  assertEqual(closed.motion, false, "the unit's reported motion gate");
  assertLessThanOrEqual(
    distance(opened, closed),
    HELD_TOLERANCE,
    `the logical units a held ${UNIT} moved over ${SPAN_SECONDS} second`,
  );
});

it("lets the unit walk with the gate on", async () => {
  const id = await poseTheWalker();
  const opened = requireUnit(await h.snapshot(), id, "the walking Mote");
  assertEqual(opened.motion, true, "a unit's motion gate starts on");

  await h.advance(framesFor(SPAN_SECONDS));
  await captureStill(h, "walking");

  const closed = requireUnit(await h.snapshot(), id, "the walking Mote");
  assertGreaterThan(
    distance(opened, closed),
    MIN_TRAVEL,
    `the logical units a walking ${UNIT} covered over ${SPAN_SECONDS} second`,
  );
});
