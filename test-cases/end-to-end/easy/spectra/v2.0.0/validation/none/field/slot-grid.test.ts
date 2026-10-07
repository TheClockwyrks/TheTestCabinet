// field/slot-grid — a formation slot sits where the grid puts it.
//
// specs/field.md, "The formation grid", fixes the grid outright: slots on a grid
// `FORM_COLS` (9) columns across by `FORM_ROWS` (5) rows down, `SLOT_DX` (64)
// apart horizontally and `SLOT_DY` (48) apart vertically, centred on
// `FORM_CENTER_X` (640) with its top row at `FORM_ROW0_Y` (140), so that
// `slotX(col) = FORM_CENTER_X + SLOT_DX * (col - (FORM_COLS - 1) / 2)` and
// `slotY(row) = FORM_ROW0_Y + SLOT_DY * row`, and "The filled grid therefore spans
// `x` in `[384, 896]` and `y` in `[140, 332]`." "The sway" then puts a drone
// resting in one at `(slotX(col) + swayOffset(t), slotY(row))`.
//
// THE GRID IS READ OFF THE WAVE THE BUILD LAYS OUT, and that is the whole point of
// this check. A drone POSED into a slot is posed with the slot this project
// computed, so a build with the wrong column pitch would place it exactly where it
// was told and grade perfectly — the two functions above would never run. So the
// route is `startStage`: the build opens its own stage-1 wave, chooses its own
// layout, flies its own entrance, and every drone that settles has to land on a
// slot of the SPECIFICATION's grid. That a drone then holds that slot through the
// sway is `swarm/formation-holds-slot`, and that it gets there at all within twelve
// seconds is `swarm/assembles`; this point reads only WHERE the slots are.
//
// TWO OF THE WAVE'S OWN FACULTIES ARE SHUT ONCE IT IS OPEN. Dive launching, because
// a launch takes a drone out of the formation at `DIVE_FIRST_DELAY` (2.0 s) and the
// assembly this reads takes longer than that; and the ship's contact test, because
// an entrance path crossing the parked ship would cost a life and end the live
// wave. Neither is this point's requirement, and neither belongs to any drone: they
// are the wave's own gates, which specs/instrumentation.md provides for exactly
// this. The ENTRY gate is left alone, because the wave that entry lays out is the
// thing being read.
//
// THE SWAY OFFSET IS RECOVERED RATHER THAN ASSUMED, AND THEN BOUNDED. No operation
// sets the wave's sway clock and no snapshot field reports it, so the block's
// offset is read out of the drones themselves: every `slotX(col)` is a whole
// multiple of `SLOT_DX` away from every other, so the offset is what each drone's
// `x` leaves over that pitch, and `SWAY_AMP` (20) is under half of `SLOT_DX` (64),
// which makes that remainder unambiguous. Holding the fitted offset to `SWAY_AMP`
// is what stops a build whose whole grid sits off `FORM_CENTER_X` from passing by
// calling the error an offset.
//
// ONE SHIFT IS DELIBERATELY NOT READ HERE, BECAUSE IT IS NOT OBSERVABLE. A grid
// slid a whole `SLOT_DX` sideways puts its drones exactly where a grid in the right
// place with one column's different choice of filled slots would, and
// specs/swarm.md leaves that choice to the build: "Which slots a wave fills is
// yours". What pins the block to `FORM_CENTER_X` rather than to a column of it is
// the mirror-symmetry rule of the same section, which is
// `swarm/formation-symmetric` and is not restated here.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertBetween,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import {
  FORM_CENTER_X,
  FORM_COLS,
  FORM_ROW0_Y,
  FORM_ROWS,
  SLOT_DX,
  SLOT_DY,
  SWAY_AMP,
  slotX,
  slotY,
} from "../constants";
import {
  captureStill,
  createHarness,
  dronesInPhase,
  startStage,
  type Harness,
} from "../harness";

/**
 * How far a settled drone's centre may sit from the slot the grid puts it in, in
 * logical units. The item's own figure: "within one unit".
 */
const GRID_TOLERANCE = 1;

/**
 * How long the wave is given to assemble, in seconds of game time.
 *
 * specs/swarm.md gives a released drone six seconds to reach its slot and releases
 * its last group `ENTER_GROUP_GAP` (0.6 s) times seven after the wave opens, for a
 * ceiling of 10.2 s; `swarm/assembles` reads that ceiling as twelve. Sixteen is
 * that with slack: a bound on a wave that never assembles, not a tolerance on when
 * it does.
 */
const ASSEMBLE_SECONDS = 16;

/**
 * The fewest settled drones this reads before it decides.
 *
 * One. specs/swarm.md leaves the size of a wave to the build — "Which slots a
 * wave fills is yours" — so a count is not this point's to demand; what a wave is
 * made of is `swarm/wave-composition`. This is the precondition that the reading
 * happened at all, since the block's offset below is fitted over the drones that
 * settled.
 */
const SLOTS_MIN = 1;

/** The signed remainder of `value` over `pitch`, in `[-pitch / 2, pitch / 2)`. */
function centredRemainder(value: number, pitch: number): number {
  const wrapped = (((value % pitch) + pitch) % pitch) + pitch / 2;
  return (wrapped % pitch) - pitch / 2;
}

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("settles the wave's drones onto slotX(col), slotY(row) plus the block's sway", async () => {
  // The build's own stage-1 wave, opened by running its stage intro out, with the
  // entry gate exactly as the specification leaves it.
  await startStage(harness, 1);
  await harness.debug.setDiveLaunching(false);
  await harness.debug.setShipContact(false);

  const assembled = await harness.skipUntil(
    (snapshot) =>
      snapshot.drones.length > 0 &&
      snapshot.drones.every((drone) => drone.phase === "formation"),
    { maxSeconds: ASSEMBLE_SECONDS, pollSeconds: 0.25 },
  );
  await harness.advance(1);
  const settled = await harness.snapshot();
  await captureStill(harness, "grid");

  const resting = dronesInPhase(settled, "formation");
  assertGreaterThanOrEqual(
    resting.length,
    SLOTS_MIN,
    `drones resting in formation ${assembled.elapsed.toFixed(1)} s after the ` +
      `stage-1 wave opened, whose slots this reads (specs/swarm.md)`,
  );

  // The block's one horizontal offset, recovered from what each drone's x leaves
  // over the grid's own pitch.
  const offset =
    resting.reduce(
      (sum, drone) => sum + centredRemainder(drone.x - FORM_CENTER_X, SLOT_DX),
      0,
    ) / resting.length;
  assertLessThanOrEqual(
    Math.abs(offset),
    SWAY_AMP + GRID_TOLERANCE,
    `the formation's horizontal offset from the grid centred on FORM_CENTER_X ` +
      `(${FORM_CENTER_X}), which specs/field.md bounds by SWAY_AMP (${SWAY_AMP})`,
  );

  for (const drone of resting) {
    const col = Math.round(
      (drone.x - offset - FORM_CENTER_X) / SLOT_DX + (FORM_COLS - 1) / 2,
    );
    const row = Math.round((drone.y - FORM_ROW0_Y) / SLOT_DY);
    assertBetween(
      col,
      0,
      FORM_COLS - 1,
      `the column drone ${drone.id} rests in, at x ${drone.x.toFixed(2)} with ` +
        `the block offset ${offset.toFixed(2)} — specs/field.md gives the grid ` +
        `${FORM_COLS} columns`,
    );
    assertBetween(
      row,
      0,
      FORM_ROWS - 1,
      `the row drone ${drone.id} rests in, at y ${drone.y.toFixed(2)} — ` +
        `specs/field.md gives the grid ${FORM_ROWS} rows`,
    );
    assertLessThanOrEqual(
      Math.abs(drone.x - (slotX(col) + offset)),
      GRID_TOLERANCE,
      `how far drone ${drone.id} sat from slotX(${col}) = ${slotX(col)} plus the ` +
        `block's offset of ${offset.toFixed(2)} (specs/field.md)`,
    );
    assertLessThanOrEqual(
      Math.abs(drone.y - slotY(row)),
      GRID_TOLERANCE,
      `how far drone ${drone.id} sat from slotY(${row}) = ${slotY(row)}, which ` +
        `the sway never moves (specs/field.md)`,
    );
  }
});
