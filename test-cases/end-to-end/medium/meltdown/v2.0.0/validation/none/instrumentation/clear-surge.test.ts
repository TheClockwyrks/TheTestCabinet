// Meltdown — instrumentation/clear-surge: `clearSurge` empties the surge roster
// and leaves every tower exactly as it found it.
//
// THE RULE. `specs/instrumentation.md`: "`clearSurge()` Removes every unit,
// leaving the towers standing with their heat, levels, and tallies untouched. It
// costs no life, pays no bounty, and changes neither score nor money."
//
// WHY IT IS A POINT. `startRun` clears the surge to open every scenario in this
// project, and a great many of those scenarios then measure a tower — its heat
// after a second, the damage it dealt, the level it was posed at. A build whose
// `clearSurge` reaches through its own removal path and, say, resets each
// tower's target and its tallies with it, hands those checks a tower it quietly
// wiped, and the reading that fails names combat or heat rather than the surface.
//
// THE TWO HALVES ARE READ SEPARATELY. Emptying the roster is the easy one. The
// hard one is that a tower carrying something worth losing — a posed heat, a
// posed level, and a tally it earned by actually firing — carries all of it
// across the clear. The tally is earned rather than posed because there is no
// operation that sets `kills` or `damageDealt`: the tower is given a target and
// left to fire at it, so what the clear must not touch is a number the build
// itself put there.
//
// THE READINGS BRACKET THE CLEAR WITH NO FRAME BETWEEN THEM, which is what makes
// the comparison exact: `clearSurge` resolves outside a frame
// (`specs/instrumentation.md`), so a conformant build changes NOTHING about the
// tower, not "little enough". `firing` and `targeting` are the two fields left out
// of the comparison, and they are left out on purpose — both are the tower's
// answer for the frame it is in, and the unit they answered about has just been
// taken off the floor.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { SURGE_TYPES, TOWER_DEFS, emitterStats, isEmitter } from "../constants";
import { freeSite } from "../fixtures";
import {
  captureStill,
  createHarness,
  framesForShots,
  poseTarget,
  poseTower,
  poseWalker,
  requireTower,
  startRun,
  type Harness,
} from "../harness";

/** The emitter whose readings must survive the clear, and how it is posed. */
const TOWER = "arc";
const POSED_HEAT = 63;
const POSED_LEVEL = 2;
/** Shots driven before the clear, so the tower carries a tally it earned. */
const SHOTS = 3;

/** Where the target stands relative to the emitter's footprint, in tiles. */
const TARGET_OFFSET = 5;
/** Hp far past what three shots remove, so no kill is reached. */
const TARGET_HP = 5000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes every unit and leaves the towers standing", async () => {
  await startRun(h);
  const site = freeSite(0);
  const kept = await poseTower(h, TOWER, site.col, site.row);
  const other = freeSite(1);
  const alsoKept = await poseTower(h, "forge", other.col, other.row);
  for (const [index, type] of SURGE_TYPES.entries()) {
    await poseWalker(h, type, index % 2 === 0 ? "left" : "top");
  }
  await h.advance(1);
  assertLength(
    (await h.snapshot()).surge,
    SURGE_TYPES.length,
    "the surge posed onto the floor",
  );

  await h.debug.clearSurge();
  await h.advance(1);
  await captureStill(h, "cleared");

  const cleared = await h.snapshot();
  assertLength(cleared.surge, 0, "the surge roster after clearSurge");
  assertDeepEqual(
    cleared.towers.map((tower) => tower.id),
    [kept, alsoKept],
    "the tower roster after clearSurge",
  );
});

it("leaves a tower's heat, level and tallies untouched", async () => {
  await startRun(h);
  const site = freeSite(0);
  const id = await poseTower(h, TOWER, site.col, site.row);
  await h.debug.setTowerLevel(id, POSED_LEVEL);
  // The thermal model is held so the heat this check compares is the one it
  // posed, not one that drifted while the shots were being fired.
  await h.debug.setTowerThermal(id, false);
  await h.debug.setTowerHeat(id, POSED_HEAT);

  // The rate the specification gives this emitter at this level, so the drive
  // stops mid-cycle after exactly `SHOTS` shots (`specs/towers.md`).
  const def = TOWER_DEFS[TOWER];
  if (!isEmitter(def)) throw new TypeError(`${TOWER} is not an emitter`);
  const { fireRate } = emitterStats(def, POSED_LEVEL);
  await poseTarget(h, "mote", site.col + TARGET_OFFSET, site.row, TARGET_HP);
  await h.advance(framesForShots(SHOTS, fireRate));

  const before = requireTower(await h.snapshot(), id, "the firing Arc");
  await h.debug.clearSurge();
  const after = requireTower(await h.snapshot(), id, "the Arc after the clear");

  assertLength(
    (await h.snapshot()).surge,
    0,
    "the surge roster after clearSurge",
  );
  assertEqual(after.heat, before.heat, "the tower's heat across clearSurge");
  assertEqual(after.level, before.level, "the tower's level across clearSurge");
  assertEqual(after.kills, before.kills, "the tower's kills across clearSurge");
  assertEqual(
    after.damageDealt,
    before.damageDealt,
    "the tower's damageDealt across clearSurge",
  );
  assertEqual(after.spent, before.spent, "the tower's spent across clearSurge");
  assertEqual(
    after.tripped,
    before.tripped,
    "the tower's trip across clearSurge",
  );
  assertEqual(
    after.fresh,
    before.fresh,
    "the tower's freshness across clearSurge",
  );
});
