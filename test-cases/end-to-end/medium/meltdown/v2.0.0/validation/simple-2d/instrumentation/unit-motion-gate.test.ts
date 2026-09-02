// Meltdown — instrumentation/unit-motion-gate: motion off holds a unit still.
//
// specs/instrumentation.md, The surge: "`motion` gates the unit's locomotion, which
// is whether it advances along its route or its flight line, and nothing else. Off,
// the unit holds its position."
//
// TWO WINDOWS OF THE SAME LENGTH ON THE SAME ARRANGEMENT, and the running one is
// what stops the held one passing vacuously: a build in which nothing ever moves
// holds a unit perfectly still, so the same Mote posed on the same tile with its
// motion on must travel. The pair is what makes this a reading of the GATE rather
// than of a floor that does not run.
//
// EACH WINDOW IS BRACKETED BY ONE SNAPSHOT AT THE CALL AND ONE WHEN IT CLOSES,
// through the harness's `overWindow`, so the pair spans the window the pose opened
// and nothing else.
//
// THE ROW IS OPEN AND THE ROUTE IS STRAIGHT. The unit is posed five tiles into the
// left corridor, whose route to the right exhaust runs straight east across an empty
// floor (specs/floor.md, specs/mazing.md), so the running window's travel is a walk
// in one direction with no turn in it and the two windows are comparable.
//
// THE HELD BOUND IS NON-ZERO BUT NEARLY SO. A held unit takes no part in locomotion
// at all, so a conforming build has nothing to move it by and nothing to accumulate;
// a thousandth of a logical unit is far below anything a build could reach by
// rounding a position it is not changing, and sixty thousand times below the `60`
// logical units a Mote covers in the same second (specs/surge.md).

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { TILE } from "../constants";
import {
  captureStill,
  createHarness,
  overWindow,
  startRun,
  ticksFor,
  type Harness,
} from "../harness";
import { WALK, poseWalkerOn } from "./scenes";

/** The window each leg is read over: one second of game time. */
const WINDOW_TICKS = ticksFor(1);

/**
 * How far a held unit may drift over that second, in logical units.
 *
 * A thousandth of a unit. Locomotion is the whole of what the gate holds, so a
 * conforming build moves the unit by nothing at all; the bound is here for the
 * representation of a position that is not being changed, and the reading it has to
 * refuse is a Mote's `60` logical units a second (specs/surge.md).
 */
const HELD_UNITS = 0.001;

/**
 * How far the same unit must travel with the gate on, in logical units.
 *
 * One tile, which is under a third of a Mote's specified `60` logical units a second
 * (specs/surge.md). What the bound separates is a unit that is WALKING from one that
 * is not; how fast a Mote walks is `surge`'s own item.
 */
const MOVING_MIN = TILE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Pose one Mote on the corridor with its motion as named, and read what it travelled. */
async function travelledWith(motion: boolean, output: string): Promise<number> {
  startRun(h);
  const walker = poseWalkerOn(h, "mote", WALK.col, WALK.row);
  h.debug.setUnitMotion(walker, motion);
  const window = await overWindow(h, WINDOW_TICKS);
  captureStill(h, output);
  return window.travel(walker);
}

it("holds the unit's position, and lets it travel again", async () => {
  const held = await travelledWith(false, "held");
  assertLessThanOrEqual(
    held,
    HELD_UNITS,
    "logical units a Mote with its motion off travelled over a second",
  );

  const walking = await travelledWith(true, "walking");
  assertGreaterThan(
    walking,
    MOVING_MIN,
    "logical units the same Mote travelled with its motion on",
  );
});
