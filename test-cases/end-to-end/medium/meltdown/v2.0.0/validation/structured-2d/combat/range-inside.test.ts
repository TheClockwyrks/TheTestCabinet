// combat/range-inside — a unit inside the radius is targeted.
//
// specs/combat.md, Range: "a surge unit is in range when the distance from that
// centre to the unit's centre is AT MOST `range * TILE` logical units". The
// boundary is IN, so the unit this check poses stands at exactly that distance
// from the footprint's centre — the last position the rule admits — and the
// tower must report it as `targeting`.
//
// Posing the extreme rather than a unit comfortably inside is what makes the
// pair with `range-outside` decide the radius: one unit at `range * TILE` and
// one a single logical unit further out bracket the figure to within a unit,
// where two units either side of a rough guess would not.
//
// The unit is placed straight out along +x from the footprint's centre, so the
// distance the rule speaks of is a subtraction and nothing about the placement
// depends on a diagonal. It is the only unit on the floor, so which unit gets
// picked is not in question here — `targets-the-unit-furthest-along` decides
// that — and the tower is pinned so nothing in its thermal model moves.

import { afterEach, beforeEach, it } from "vitest";
import { TILE, TOWER_DEFS, type EmitterDef } from "../../src/constants";
import { assertEqual, assertTruthy } from "../assert";
import {
  captureStill,
  createHarness,
  footprintCenter,
  posePinnedTower,
  poseTargetAt,
  startRun,
  towerById,
  type Harness,
  type TowerSnapshot,
} from "../harness";

const ARC = TOWER_DEFS.arc as EmitterDef;

/**
 * A quiet footprint anchor: clear of the left corridor (rows 16..19) and of the
 * top one (columns 22..29) (specs/floor.md), and far enough from the right wall
 * that a unit a full radius out still stands on the floor.
 */
const SITE = { col: 4, row: 4 };

/** The point range is measured from (specs/combat.md, Range). */
const CENTRE = footprintCenter("arc", SITE.col, SITE.row);

/** specs/towers.md: the Arc's level-I radius is 6.0 tiles. */
const REACH = ARC.range * TILE;

/** The heat the tower is pinned at, so nothing in its thermal model moves. */
const PINNED_HEAT = 0;

/** More hp than a shot removes, so the unit cannot leave before it is read. */
const TARGET_HP = 10_000;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

/** The tower as the snapshot reports it; a tower that has gone fails here. */
function towerNow(id: number): TowerSnapshot {
  const tower = towerById(harness.snapshot(), id);
  assertTruthy(tower, `the tower ${id} still on the floor`);
  return tower as TowerSnapshot;
}

it("targets a unit standing exactly a radius from the footprint centre", async () => {
  startRun(harness);
  const arc = posePinnedTower(harness, "arc", SITE.col, SITE.row, PINNED_HEAT);
  const target = poseTargetAt(
    harness,
    "mote",
    CENTRE.x + REACH,
    CENTRE.y,
    TARGET_HP,
  );

  // One frame, which is what acquires a target: the tower reports `targeting`
  // for the frame it ran, not for the moment the unit was posed.
  await harness.advance(1);
  captureStill(harness, "inside");

  assertEqual(
    towerNow(arc).targeting,
    target,
    `the unit at ${REACH} units, exactly ${ARC.range} tiles from the centre`,
  );
});
