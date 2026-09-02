// Meltdown — instrumentation/unit-motion-gate: motion off holds a unit still.
//
// `specs/instrumentation.md`: "`motion` gates the unit's locomotion, which is
// whether it advances along its route or its flight line, and nothing else. Off,
// the unit holds its position ... It is `true` for a unit the game itself
// released."
//
// SO THE READING IS A POSITION, TAKEN OVER A SECOND, IN BOTH DIRECTIONS. Held,
// the unit's centre is exactly where it was put; free, it has travelled. Neither
// leg would do alone: the held leg passes on a build whose units never move, and
// the free leg says nothing about the gate.
//
// THE ROW IS OPEN AND THE FLOOR IS EMPTY. `specs/floor.md` runs the left vent and
// the right exhaust along the same four rows, so a unit posed on one of them with
// nothing built walks a straight line and no turn, no wall and no re-path can be
// mistaken for the gate. There is no tower to shoot it and the world gate holds
// the run's own release, so nothing but the gate decides whether it moves.
//
// THE TWO LEGS RUN ONE AFTER THE OTHER ON A FLOOR RESET BETWEEN THEM, so each
// leaves a still of its own and the two units cannot be confused for one another.
//
// WHAT IS NOT READ HERE. That the route stays live under the gate is
// `unit-motion-gate-leaves-pathing`'s point, so a build that froze the unit and
// its route together is graded there rather than twice over here.

import { afterEach, beforeEach, it } from "vitest";
import { SURGE_DEFS } from "../constants";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import {
  captureStill,
  createHarness,
  distance,
  positionOf,
  startRun,
  ticksFor,
  type Harness,
} from "../harness";
import { OPEN_ROW, poseWalkerAt, readUnit } from "./ground";

/** The type posed, and the speed `specs/surge.md` gives it. */
const TYPE = "mote";
const SPEED = SURGE_DEFS[TYPE].speed;

/** The game time each leg is given, in seconds. */
const WINDOW = 1;

/**
 * How far a held unit's centre may sit from where it was put, in logical units.
 *
 * The gate holds the locomotion outright, so a conformant build reports the exact
 * coordinates it was handed; the allowance is for the float they are stored in. It
 * is nine orders of magnitude below the `19`-unit tile `specs/floor.md` fixes.
 */
const HELD_TOLERANCE = 1e-9;

/**
 * The least distance the free leg must cover, in logical units.
 *
 * `specs/surge.md` gives the Mote `60` logical units a second, so a second carries
 * it about three tiles. A tenth of that is far under anything a walking build
 * produces and far over the zero a held one does — and it is stated as a fraction
 * of the specified speed rather than as the speed itself, because how fast the
 * unit walks is `surge/`'s point and not this gate's.
 */
const MIN_TRAVEL = SPEED * WINDOW * 0.1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds a unit where it was put, and lets it walk when the gate is opened", async () => {
  assertGreaterThan(
    MIN_TRAVEL,
    0,
    "precondition: the specified speed gives the window a distance to read",
  );

  // ---- The gate closed ---------------------------------------------------
  startRun(h);
  const heldId = poseWalkerAt(h, TYPE, OPEN_ROW);
  h.debug.setUnitMotion(heldId, false);
  const heldStart = positionOf(readUnit(h.snapshot(), heldId, "the held unit"));

  await h.advance(ticksFor(WINDOW));
  captureStill(h, "held");
  const heldEnd = positionOf(
    readUnit(h.snapshot(), heldId, "the held unit after a second"),
  );
  assertEqual(
    readUnit(h.snapshot(), heldId, "the held unit").motion,
    false,
    "precondition: the unit's motion faculty is held",
  );
  assertLessThan(
    distance(heldStart, heldEnd),
    HELD_TOLERANCE,
    "the logical units a held unit moved over a second",
  );

  // ---- The gate open, on an identical floor ------------------------------
  startRun(h);
  const freeId = poseWalkerAt(h, TYPE, OPEN_ROW);
  h.debug.setUnitMotion(freeId, true);
  const freeStart = positionOf(readUnit(h.snapshot(), freeId, "the free unit"));

  await h.advance(ticksFor(WINDOW));
  captureStill(h, "walking");
  const freeEnd = positionOf(
    readUnit(h.snapshot(), freeId, "the free unit after a second"),
  );
  assertGreaterThan(
    distance(freeStart, freeEnd),
    MIN_TRAVEL,
    "the logical units a free unit covered over a second",
  );
});
