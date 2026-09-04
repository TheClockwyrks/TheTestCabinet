// Meltdown — instrumentation/clear-surge: `clearSurge` empties the surge alone.
//
// `specs/instrumentation.md`: "`clearSurge()` — Removes every unit, leaving the
// towers standing with their heat, levels, and tallies untouched."
//
// THE TALLIES ARE WHY THE TOWER IS DRIVEN RATHER THAN POSED. `specs/combat.md`
// makes `kills` and `damageDealt` the running record of what an emitter has done
// "for its whole life on the floor", and no operation of this surface poses
// either, so the only way to have one to protect is to let a gun earn it: the Arc
// below fires on a mark it can kill, and the count it holds afterwards is the
// count the clear must leave alone. A build whose `clearSurge` reset the towers'
// tallies along with the roster — a plausible mistake, since a tally is about
// units — is caught by exactly that.
//
// THE HEAT AND THE LEVEL ARE READ BESIDE THEM, because "heat, levels, and
// tallies" is three claims. The heat is posed to a figure no floor arrives at by
// itself, and the tower's thermal faculty is held so that the frame between the
// two readings cannot move it: the question is whether the CLEAR moved it, and a
// tower left free to cool would drift for a reason that has nothing to do with
// this point.
//
// A SECOND WAVE OF UNITS IS ADDED BEFORE THE CLEAR, so the reading is of "every
// unit" rather than of the one the Arc happened to leave behind, and the roster
// is read for emptiness rather than for a smaller number.
//
// What a clear COSTS — a life, a bounty, a score — is `clear-surge-costs-nothing`,
// so a build that empties the floor and charges for it is graded apart from one
// whose clear does not clear.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  ticksFor,
  tileCenter,
  type Harness,
} from "../harness";
import { markTile, quietSite, readTower } from "./ground";

/** The heat the gun is pinned at: a figure a placed tower never opens on. */
const POSED_HEAT = 47;

/** The level the gun is posed at, which no upgrade below pays for. */
const POSED_LEVEL = 2;

/** The hp the mark is posed with: the least a live unit can carry, so one shot kills it. */
const MARK_HP = 1;

/**
 * How long the gun is given to earn a tally, in frames.
 *
 * Geometry rather than a tolerance: `specs/towers.md` gives the Arc `2.0` shots a
 * second at level I and `specs/combat.md` lands its first shot one whole interval
 * after the target is acquired, so six seconds is a dozen intervals. A build whose
 * fire rate is off still lands one, and the tally this point protects rests on a
 * shot landing at all.
 */
const KILL_FRAMES = ticksFor(6);

/** Units added after the tally is earned, which the clear must also remove. */
const EXTRA_UNITS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes every unit and leaves the towers' heat, levels and tallies where they were", async () => {
  startRun(h);

  // A gun whose heat cannot drift while a reading is taken, posed above the heat
  // and the level a placed tower opens at.
  const site = quietSite(0);
  h.debug.addTower("arc", site.col, site.row, 0);
  const gun = h.snapshot().towers[0].id;
  h.debug.setTowerThermal(gun, false);
  h.debug.setTowerHeat(gun, POSED_HEAT);
  h.debug.setTowerLevel(gun, POSED_LEVEL);

  // A mark of one hp beside it, held on its tile so it dies to the shot rather
  // than walking out of range.
  const mark = markTile(site);
  h.debug.addUnit("mote", "left");
  const markId = h.snapshot().surge[0].id;
  const at = tileCenter(mark.col, mark.row);
  h.debug.setUnitPosition(markId, at.x, at.y);
  h.debug.setUnitMotion(markId, false);
  h.debug.setUnitMaxHp(markId, MARK_HP);
  h.debug.setUnitHp(markId, MARK_HP);

  await h.until((snapshot) => snapshot.surge.length === 0, {
    maxFrames: KILL_FRAMES,
    poll: 4,
  });

  const earned = readTower(h.snapshot(), gun, "the gun after its shot");
  assertGreaterThan(
    earned.kills,
    0,
    "precondition: the gun earned a kill for the clear to leave alone",
  );
  assertGreaterThan(
    earned.damageDealt,
    0,
    "precondition: the gun earned a damage tally for the clear to leave alone",
  );

  // More units, so what is cleared is a roster rather than a leftover.
  for (let i = 0; i < EXTRA_UNITS; i += 1) {
    h.debug.addUnit("mote", "left");
    const surge = h.snapshot().surge;
    const unit = surge[surge.length - 1];
    const spot = quietSite(i + 8);
    const where = tileCenter(spot.col, spot.row);
    h.debug.setUnitPosition(unit.id, where.x, where.y);
    h.debug.setUnitMotion(unit.id, false);
  }
  const before = h.snapshot();
  assertLength(
    before.surge,
    EXTRA_UNITS,
    "precondition: the units the clear is asked to remove",
  );
  const standing = readTower(before, gun, "the gun before the clear");

  h.debug.clearSurge();
  await h.advance(1);
  captureStill(h, "cleared");
  const after = h.snapshot();

  assertLength(after.surge, 0, "the surge roster after clearSurge");
  assertLength(
    after.towers,
    1,
    "the towers still standing after clearSurge, which clears the surge alone",
  );
  const left = readTower(after, gun, "the gun after clearSurge");
  assertEqual(left.heat, standing.heat, "the tower's heat after clearSurge");
  assertEqual(left.level, standing.level, "the tower's level after clearSurge");
  assertEqual(left.kills, standing.kills, "the tower's kills after clearSurge");
  assertEqual(
    left.damageDealt,
    standing.damageDealt,
    "the tower's damage tally after clearSurge",
  );
  assertEqual(
    left.spent,
    standing.spent,
    "the tower's spent tally after clearSurge",
  );
});
