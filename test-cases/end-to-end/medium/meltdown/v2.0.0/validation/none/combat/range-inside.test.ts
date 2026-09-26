// Meltdown — combat/range-inside: a unit at the radius is targeted.
//
// `specs/combat.md`: "A surge unit is in range when the distance from that centre
// to the unit's centre is AT MOST `range * TILE` logical units". The boundary is
// inclusive, so a mark whose centre lies exactly `range * TILE` from the
// footprint centre is a legal target and must be reported as one.
//
// EXACTLY AT THE BOUNDARY, BECAUSE THAT IS THE FIGURE THE SPECIFICATION FIXES. A
// mark posed comfortably inside would pass on any build whose radius is within a
// tile of the right one, so the reading is taken where the rule is sharp:
// `specs/towers.md` gives the Arc `6.0` tiles and `specs/floor.md` gives `TILE`
// `19`, so the mark stands `114` logical units due east of the footprint's
// centre. A build that measures in whole tiles and rounds down, one that shortens
// the radius by any amount at all, and one that reads the bound as exclusive each
// report no target here. `combat/range-outside` takes the other side of the same
// figure.
//
// DUE EAST, so the distance is one exact subtraction rather than a hypotenuse,
// and the reading cannot turn on how a build accumulated a square root.
//
// ONE MARK ON AN EMPTY FLOOR. There is no second unit for the target rule to
// prefer, so `targeting` names this mark or it names nothing, and what is graded
// is the range rule alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { poseGun, poseMarkEast, rangeUnitsOf, readGun } from "./duel";

/** The emitter read, and the heat it is pinned at. */
const TOWER = "arc";
const HEAT = 0;

/** `specs/towers.md` and `specs/floor.md`: 6.0 tiles of 19 units, so 114. */
const RADIUS_UNITS = rangeUnitsOf(TOWER);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("A unit inside the radius is targeted", async () => {
  const gunId = await poseGun(h, TOWER, HEAT);
  const mark = await poseMarkEast(h, TOWER, "mote", RADIUS_UNITS);

  await h.advance(1);
  await captureStill(h, "inside");
  const gun = await readGun(h, gunId, "the emitter with a mark at its radius");

  assertEqual(
    gun.targeting,
    mark,
    `the unit targeted with one mark ${RADIUS_UNITS} units from the ` +
      `footprint centre, exactly the ${TOWER}'s radius`,
  );
});
