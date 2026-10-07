// firing/head-rotates — the head turns to face what it is shooting at.
//
// specs/components.md fixes it for every firing structure: "A firing structure's
// head rotates to face the unit it is firing at and holds its last heading while
// it holds fire." specs/instrumentation.md reports it as `heading`, "the firing
// head's rotation, in radians".
//
// The yard holds one structure and one held unit. The unit is placed off both axes
// so a build that only ever points along one of them is caught, and it is then
// moved to the diametrically opposite bearing, so the reading is the head
// FOLLOWING its target rather than a heading that happened to be right once. The
// specification fixes no turning rate, so the head is given two full seconds to
// settle at each bearing before it is read, and read to a tenth of a radian —
// about six degrees, which is far tighter than the difference between the two
// bearings and loose enough for any easing a build chooses.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThan } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  parkUnit,
  standComponent,
  structureById,
  type Harness,
} from "../harness";

const ANCHOR = { col: 10, row: 10 };

/** Off both axes, and inside the Scrap Capacitor's `100`. */
const OFFSET = { x: 60, y: 40 };

/** How long the head is given to settle on a bearing, in seconds. */
const SETTLE = 2;

/**
 * The rate the settling spans are covered at.
 *
 * The spans are frames spent letting a head turn and a cadence run rather than
 * frames anything is read on, and specs/instrumentation.md guarantees that "an
 * interval of simulation time reaches the same state however it was divided into
 * frames". A shot still steps well inside the `2 * PROJECTILE_HIT_R` window it
 * has to be caught in at this rate.
 */
const SETTLE_HZ = 60;

/** How close the heading must sit to the bearing, in radians. */
const TOLERANCE = 0.1;

/** The signed difference between two angles, wrapped into (-pi, pi]. */
function angleBetween(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ hz: SETTLE_HZ });
});

afterEach(() => {
  h.dispose();
});

it("points the head at its target and follows it to the other side", async () => {
  openYard(h, { wave: 1 });
  const id = standComponent(h, "capacitor", 1, ANCHOR.col, ANCHOR.row);
  const structure = structureById(h.snapshot(), id);
  const target = parkUnit(h, "dynamo", {
    x: structure.cx + OFFSET.x,
    y: structure.cy + OFFSET.y,
  });

  const opened = structureById(h.snapshot(), id).damageDealt;
  await h.advanceSeconds(SETTLE);
  let read = structureById(h.snapshot(), id);
  assertGreaterThan(
    read.damageDealt,
    opened,
    "the damage the structure dealt while settling on its first bearing, " +
      "which is what says it was firing at that unit",
  );
  const first = Math.atan2(OFFSET.y, OFFSET.x);
  assertLessThan(
    Math.abs(angleBetween(read.heading, first)),
    TOLERANCE,
    `radians between the reported heading (${read.heading.toFixed(3)}) and the ` +
      `bearing to the unit it is firing at (${first.toFixed(3)})`,
  );

  // The same unit, on the opposite side of the structure.
  const moved = read.damageDealt;
  h.debug.setUnitPosition(
    target,
    structure.cx - OFFSET.x,
    structure.cy - OFFSET.y,
  );
  await h.advanceSeconds(SETTLE);
  captureStill(h, "heading");

  read = structureById(h.snapshot(), id);
  assertGreaterThan(
    read.damageDealt,
    moved,
    "the damage the structure dealt while settling on its second bearing",
  );
  const second = Math.atan2(-OFFSET.y, -OFFSET.x);
  assertLessThan(
    Math.abs(angleBetween(read.heading, second)),
    TOLERANCE,
    `radians between the reported heading (${read.heading.toFixed(3)}) and the ` +
      `bearing to the unit after it moved to the other side ` +
      `(${second.toFixed(3)})`,
  );
});
