// Meltdown — instrumentation/clear-surge: clearSurge empties the surge alone.
//
// specs/instrumentation.md, The surge: `clearSurge()` "Removes every unit, leaving
// the towers standing with their heat, levels, and tallies untouched."
//
// THE TOWER IS GIVEN SOMETHING TO LOSE. A tower posed and never fired is at heat
// `0`, level `1`, `0` kills and `0` damage dealt — every one of them the value a
// build that reset the floor would leave behind, so the requirement would be
// unobservable. So the emitter here is taken to level II, pinned at heat `63`, and
// driven through a real kill first: its tallies are non-zero and its heat is
// nowhere near a resting value when the clear arrives.
//
// THE KILL IS THE GAME'S OWN. specs/combat.md tallies `damageDealt` as "the hp each
// of its shots actually removed" and raises `kills` "for each unit one of its shots
// takes to `0` hp"; neither can be posed, so the mark is given the least hp a live
// unit can carry and the emitter is left to fire. What this point reads is that
// those two numbers are the SAME after the clear as before it — never what they
// are, which `combat` decides.
//
// THE HEAT IS PINNED WITH `setTowerThermal(id, false)`, which holds the tower's part
// in the heat model while it goes on acquiring targets and firing
// (specs/instrumentation.md). That is what lets "its heat untouched" be read as an
// equality rather than as a tolerance: with the thermal model held there is no
// legitimate drift for a bound to have to allow, so a build whose `clearSurge`
// disturbs the heat by any amount at all is caught.
//
// AND THE READING IS TAKEN FROM THE CLEAR ITSELF, with no frame between the pose
// and the read, so nothing but `clearSurge` has had the chance to move anything.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertTrue,
} from "../assert";
import {
  captureStill,
  createHarness,
  poseTarget,
  posePinnedTower,
  poseWalker,
  startRun,
  ticksFor,
  towerOf,
  type Harness,
} from "../harness";
import { GUN, MARK } from "./scenes";

/** The emitter driven, the level it is taken to, and the heat it is pinned at. */
const TYPE = "arc";
const LEVEL = 2;
const HEAT = 63;

/** The hp the mark carries: the least a live unit can, so one shot ends it. */
const MARK_HP = 1;

/**
 * How long the kill is waited for: six seconds of game time.
 *
 * Geometry rather than a tolerance. A level-II Arc at its specified rate lands its
 * first shot under half a second in (specs/towers.md, specs/combat.md), so six
 * seconds is more than a dozen intervals: the kill this point rests on is the shot
 * landing at all, never how hard or how often it lands.
 */
const KILL_TICKS = ticksFor(6);

/** How many bystanders stand on the floor when the clear arrives. */
const BYSTANDERS = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes every unit and leaves the towers' heat, levels and tallies untouched", async () => {
  startRun(h);
  const gun = posePinnedTower(h, TYPE, GUN.col, GUN.row, HEAT);
  h.debug.setTowerLevel(gun, LEVEL);
  poseTarget(h, "mote", MARK.col, MARK.row, MARK_HP);

  const swept = await h.until((s) => s.surge.length === 0, {
    maxFrames: KILL_TICKS,
    poll: 2,
  });
  assertTrue(swept.hit, "precondition: the emitter killed its mark");

  // A roster to clear, posed after the kill so the tallies are already made.
  for (let i = 0; i < BYSTANDERS; i += 1) poseWalker(h, "mote", "left");
  await h.advance(1);

  const before = towerOf(h.snapshot(), gun);
  assertLength(
    h.snapshot().surge,
    BYSTANDERS,
    "precondition: the floor carries units to clear",
  );
  assertGreaterThan(
    before.kills,
    0,
    "precondition: the emitter has a kill tallied",
  );
  assertGreaterThan(
    before.damageDealt,
    0,
    "precondition: the emitter has damage tallied",
  );

  h.debug.clearSurge();
  const after = h.snapshot();
  const tower = towerOf(after, gun);

  assertLength(after.surge, 0, "every unit is removed");
  assertLength(after.towers, 1, "the tower is left standing");
  assertEqual(tower.heat, before.heat, "the tower's heat is untouched");
  assertEqual(tower.level, before.level, "the tower's level is untouched");
  assertEqual(tower.kills, before.kills, "the tower's kills are untouched");
  assertEqual(
    tower.damageDealt,
    before.damageDealt,
    "the tower's damage dealt is untouched",
  );
  assertEqual(tower.spent, before.spent, "the tower's spent is untouched");

  await h.advance(1);
  captureStill(h, "cleared");
});
