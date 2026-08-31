// combat/range-outside — a unit outside the radius is not targeted.
//
// specs/combat.md, Range: a unit is in range at a distance of AT MOST
// `range * TILE` from the footprint's centre, and "a unit one logical unit
// further out is not in range". This is the far half of the bracket
// `range-inside` opens: one logical unit past the Arc's `6.0 * 19` is outside,
// so the tower must take no target and its shots must never reach the unit.
//
// The reading is taken over three of the Arc's intervals rather than one frame,
// because a build whose radius is a hair too generous would fire — and the hp of
// a unit that took no damage over three intervals says so with no room for
// argument, where a single frame's `targeting` could be read as an acquisition
// that had not happened yet.
//
// The unit is the only one on the floor and the tower is pinned, so nothing but
// the distance decides the outcome.

import { afterEach, beforeEach, it } from "vitest";
import { TILE, TOWER_DEFS, type EmitterDef } from "../../src/constants";
import { assertEqual, assertNull, assertTruthy } from "../assert";
import {
  captureStill,
  createHarness,
  footprintCenter,
  posePinnedTower,
  poseTargetAt,
  startRun,
  ticksFor,
  towerById,
  unitById,
  type Harness,
  type TowerSnapshot,
  type UnitSnapshot,
} from "../harness";

const ARC = TOWER_DEFS.arc as EmitterDef;

/**
 * A quiet footprint anchor: clear of the left corridor (rows 16..19) and of the
 * top one (columns 22..29) (specs/floor.md).
 */
const SITE = { col: 4, row: 4 };

/** The point range is measured from (specs/combat.md, Range). */
const CENTRE = footprintCenter("arc", SITE.col, SITE.row);

/** specs/towers.md: the Arc's level-I radius is 6.0 tiles. */
const REACH = ARC.range * TILE;

/** specs/combat.md: one logical unit beyond the radius is out of range. */
const BEYOND = 1;

/** The heat the tower is pinned at, so nothing in its thermal model moves. */
const PINNED_HEAT = 0;

/** Three of the Arc's intervals: three chances to fire, all of which must fail. */
const WATCH_SECONDS = 3 / ARC.fireRate;

/** More hp than three shots remove, so a hit would show as a subtraction. */
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

/** The unit as the snapshot reports it; a unit that has gone fails here. */
function unitNow(id: number): UnitSnapshot {
  const unit = unitById(harness.snapshot(), id);
  assertTruthy(unit, `the unit ${id} still on the floor`);
  return unit as UnitSnapshot;
}

it("takes no target and lands no shot a unit past the radius", async () => {
  startRun(harness);
  const arc = posePinnedTower(harness, "arc", SITE.col, SITE.row, PINNED_HEAT);
  const target = poseTargetAt(
    harness,
    "mote",
    CENTRE.x + REACH + BEYOND,
    CENTRE.y,
    TARGET_HP,
  );

  await harness.advance(ticksFor(WATCH_SECONDS));
  captureStill(harness, "outside");

  const tower = towerNow(arc);
  assertNull(
    tower.targeting,
    `targeting a unit ${BEYOND} unit past ${ARC.range} tiles`,
  );
  assertEqual(tower.firing, false, "firing with nothing inside the radius");
  assertEqual(
    unitNow(target).hp,
    TARGET_HP,
    `the unit's hp after ${WATCH_SECONDS}s a unit past the radius`,
  );
});
