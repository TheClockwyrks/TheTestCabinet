// Meltdown — screens/pause-resume: RESUME returns to the match.
//
// THE RULE. `specs/screens.md`, on `paused`'s three rows: `RESUME` leads to
// "`playing`, with the floor exactly as it was left." It is the first of
// `PAUSE_ITEMS`, and "`confirm` takes the highlighted row".
//
// WHY THIS ITEM IS CAPPED `broken` AND NAMES `run`. A pause a player cannot come
// back out of strands a run already under way: the floor, the money and the wave
// are all still there and none of them can be reached again. That is a run-level
// failure rather than a cosmetic one, which is why this row is the one row of the
// three that names a functional domain.
//
// WHAT "EXACTLY AS IT WAS LEFT" IS READ AS. The two rosters, entry by entry: every
// tower's id, type, footprint, level and heat, and every unit's id, type, centre and
// hp. So a build that reached `playing` by opening a fresh run — which is
// `RESTART`'s job, one row down — fails on an emptied floor, and a build that
// rebuilt the rosters fails on the ids.
//
// THE FLOOR IS POSED WITH ONLY THE FACULTIES THIS REQUIREMENT EXERCISES, which
// here means none of them. The tower's firing and thermal gates are off and the
// unit's motion gate is off (`specs/instrumentation.md`), so nothing on the floor
// can legitimately change across the round trip and the comparison can be an exact
// one. Whether a floor RUNS again after a resume is
// `waves.resume-runs-the-floor-again`'s reading, measured on the build's own clock;
// this item is about what survives the round trip, and pinning the faculties is
// what keeps the two verdicts separate.
//
// THE ROW IS POSED, NOT WALKED, and `RESUME` is row `0`, which `reset` already
// selects — so the row is posed outright anyway, and the precondition rests on the
// pose rather than on `reset` being right.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { PAUSE_ITEMS, tileCX, tileCY } from "../constants";
import { FREE_SITE, laneTile } from "../fixtures";
import {
  captureStill,
  createHarness,
  poseTarget,
  poseTower,
  startRun,
  tapAction,
  type Harness,
  type MeltdownSnapshot,
} from "../harness";

/** The row confirmed: `RESUME`, the first of the three `PAUSE_ITEMS`. */
const RESUME_ROW = 0;

/** The heat the posed tower is carrying across the round trip. */
const POSED_HEAT = 60;

/** Where the posed unit stands: eight tiles into the left vent's corridor. */
const UNIT_TILE = laneTile("left", 8);

/**
 * What the match the pause was opened over is left carrying.
 *
 * None of the four is a figure any row of `specs/modes.md` opens a run on, and
 * the wave is not the wave a run opens on, so a build that RESTARTED the match
 * on the confirm instead of resuming it reads differently on every one of them.
 * Read against the pose rather than against a table: what the item asks is that
 * the resume changes nothing, so the figures are only ever compared with
 * themselves.
 */
const MATCH = { money: 137, lives: 13, score: 4321, wave: 7 } as const;

/** The floor, as an exact comparison: every entry of both rosters. */
function floorOf(snapshot: MeltdownSnapshot): unknown {
  return {
    towers: snapshot.towers.map((tower) => ({
      id: tower.id,
      type: tower.type,
      col: tower.col,
      row: tower.row,
      level: tower.level,
      heat: tower.heat,
    })),
    surge: snapshot.surge.map((unit) => ({
      id: unit.id,
      type: unit.type,
      x: unit.x,
      y: unit.y,
      hp: unit.hp,
    })),
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("returns to playing with the floor intact when RESUME is confirmed", async () => {
  const { debug } = h;
  await startRun(h);
  // One tower and one unit, both with every faculty this requirement does not
  // exercise switched off, so the floor cannot legitimately move.
  const tower = await poseTower(h, "arc", FREE_SITE.col, FREE_SITE.row);
  await debug.setTowerFiring(tower, false);
  await debug.setTowerThermal(tower, false);
  await debug.setTowerHeat(tower, POSED_HEAT);
  const unit = await poseTarget(h, "mote", UNIT_TILE.col, UNIT_TILE.row);
  await debug.setUnitPosition(
    unit,
    tileCX(UNIT_TILE.col),
    tileCY(UNIT_TILE.row),
  );
  await debug.setMoney(MATCH.money);
  await debug.setLives(MATCH.lives);
  await debug.setScore(MATCH.score);
  await debug.setWave(MATCH.wave);

  await debug.setScreen("paused");
  await debug.setMenuIndex(RESUME_ROW);
  await h.advance(1);

  const posed = await h.snapshot();
  assertEqual(posed.screen, "paused", "the screen the scenario is posed on");
  assertEqual(posed.menuIndex, RESUME_ROW, "the row the scenario is posed on");
  assertEqual(
    posed.towers.length,
    1,
    "the towers on the floor when it was paused",
  );
  assertEqual(
    posed.surge.length,
    1,
    "the units on the floor when it was paused",
  );
  assertEqual(
    posed.money,
    MATCH.money,
    "the money the match was paused holding",
  );
  assertEqual(
    posed.lives,
    MATCH.lives,
    "the lives the match was paused holding",
  );
  assertEqual(
    posed.score,
    MATCH.score,
    "the score the match was paused holding",
  );
  assertEqual(posed.wave, MATCH.wave, "the wave the match was paused on");
  const left = floorOf(posed);

  await tapAction(h, "confirm");
  await h.advance(1);
  await captureStill(h, "resumed");

  const after = await h.snapshot();
  const where = `${PAUSE_ITEMS[RESUME_ROW]}, row ${RESUME_ROW} of ${PAUSE_ITEMS.length} on the pause menu`;
  assertEqual(
    after.screen,
    "playing",
    `the screen confirming ${where} leads to`,
  );
  assertEqual(
    after.phase,
    posed.phase,
    `the phase the resumed match is in, after ${where}`,
  );
  // The run's own figures, which a resume returns to as surely as the floor
  // does: a build that reopened the match on a fresh purse, a fresh score or a
  // fresh wave has restarted it rather than resumed it.
  assertEqual(
    after.wave,
    posed.wave,
    `the wave the match was left on, after ${where}`,
  );
  assertEqual(
    after.money,
    posed.money,
    `the money the match was left holding, after ${where}`,
  );
  assertEqual(
    after.lives,
    posed.lives,
    `the lives the match was left holding, after ${where}`,
  );
  assertEqual(
    after.score,
    posed.score,
    `the score the match was left holding, after ${where}`,
  );
  assertDeepEqual(
    floorOf(after),
    left,
    `the floor after ${where}, which must be exactly the floor the pause was opened over`,
  );
});
