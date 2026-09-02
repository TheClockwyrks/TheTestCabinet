// screens/pause-resume — confirming RESUME returns to the match, with the floor as
// it was left.
//
// THE RULE. specs/screens.md's `paused` table: the `RESUME` row leads to
// "`playing`, with the floor exactly as it was left."
//
// BOTH HALVES, BECAUSE A BUILD CAN GET BACK TO THE FLOOR AND STILL LOSE IT. The
// screen says the player is back in the match; the floor says it is the SAME
// match. A build that answers RESUME by opening a fresh run has taken away
// everything the player built, and reports `playing` while doing it — which is
// exactly why this item caps at `broken` on the `run` domain rather than on
// presentation alone. So the towers, the surge, the money, the lives, the score,
// the wave and the phase are all read across the press, and each must come back
// the way it went in.
//
// WHAT PAUSING DOES TO TIME IS NOT READ HERE. That the floor freezes while paused
// and runs again on resume is `waves.pause-freezes-the-floor` and
// `waves.resume-runs-the-floor-again`, both measured over windows of the build's
// own clock. This item is the state either side of one press.
//
// THE FLOOR IS POSED WITH ONLY THE FACULTIES THE READING NEEDS. Both towers' guns
// and their thermal models are held off and the unit's motion is off
// (specs/instrumentation.md), so nothing on the floor can move of its own accord
// across the frames the press takes. That is what lets the position, the hp and the
// heat be read back EXACTLY rather than through a tolerance: a build may legally
// resolve an injected key on the frame after the one it arrived in, and with every
// faculty held that extra frame moves nothing. Their values are posed to figures
// nothing in the game would land on by accident, so a build that rebuilt the floor
// from scratch reads different numbers rather than the same ones.
//
// THE PAUSE SCREEN IS POSED, NOT PRESSED FOR. How a player gets to it is
// `controls.esc-pauses` and `controls.pause-key`; `setScreen` runs no entry effect
// (specs/instrumentation.md), so what is graded here is the RESUME row alone.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, PAUSE_ITEMS } from "../constants";
import { assertDeepEqual, assertEqual } from "../assert";
import { tileCentre } from "../geometry";
import {
  captureStill,
  createHarness,
  poseTarget,
  poseTower,
  unitOf,
  type Harness,
} from "../harness";
import { poseMenu } from "./menu";

/** The key specs/controls.md binds `confirm` to. */
const CONFIRM = BINDINGS.confirm[0];

/** The row `RESUME` sits on, first of the three `PAUSE_ITEMS`. */
const RESUME_ROW = 0;

/** Two towers standing where the maze would be, well clear of the openings. */
const TOWERS: readonly { type: "arc" | "sink"; col: number; row: number }[] = [
  { type: "arc", col: 12, row: 14 },
  { type: "sink", col: 12, row: 16 },
];

/** Where the posed unit stands, and the hp it carries: neither a starting figure. */
const UNIT_TILE = { col: 8, row: 5 } as const;
const UNIT_HP = 37;

/** The heat the posed Arc carries across the round trip, its thermal model held. */
const TOWER_HEAT = 43;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the match with the floor as it was left", async () => {
  assertEqual(
    PAUSE_ITEMS[RESUME_ROW],
    "RESUME",
    "posing: the row this item is about (specs/screens.md, PAUSE_ITEMS)",
  );
  poseMenu(h, "paused", RESUME_ROW);
  for (const tower of TOWERS) {
    const id = poseTower(h, tower.type, tower.col, tower.row);
    h.debug.setTowerFiring(id, false);
    h.debug.setTowerThermal(id, false);
    if (tower.type === "arc") h.debug.setTowerHeat(id, TOWER_HEAT);
  }
  poseTarget(h, "mote", UNIT_TILE.col, UNIT_TILE.row, UNIT_HP);
  await h.advance(1);

  const before = h.snapshot();
  assertEqual(
    before.screen,
    "paused",
    "posing: the screen the press is made on (specs/screens.md)",
  );

  await h.tap(CONFIRM);
  captureStill(h, "resumed");

  const after = h.snapshot();
  assertEqual(
    after.screen,
    "playing",
    `${CONFIRM} on the RESUME row: the screen it leads to (specs/screens.md)`,
  );
  assertEqual(
    after.phase,
    before.phase,
    "the phase the match was left in (specs/screens.md)",
  );
  assertEqual(
    after.wave,
    before.wave,
    "the wave the match was left on (specs/screens.md)",
  );
  assertEqual(
    after.money,
    before.money,
    "the money the match was left holding (specs/screens.md)",
  );
  assertEqual(
    after.lives,
    before.lives,
    "the lives the match was left holding (specs/screens.md)",
  );
  assertEqual(
    after.score,
    before.score,
    "the score the match was left holding (specs/screens.md)",
  );

  assertDeepEqual(
    after.towers.map((tower) => ({
      id: tower.id,
      type: tower.type,
      col: tower.col,
      row: tower.row,
      level: tower.level,
      heat: tower.heat,
    })),
    before.towers.map((tower) => ({
      id: tower.id,
      type: tower.type,
      col: tower.col,
      row: tower.row,
      level: tower.level,
      heat: tower.heat,
    })),
    "the towers standing on the floor the match was left with " +
      "(specs/screens.md)",
  );
  assertDeepEqual(
    after.surge.map((unit) => ({ id: unit.id, type: unit.type })),
    before.surge.map((unit) => ({ id: unit.id, type: unit.type })),
    "the surge on the floor the match was left with (specs/screens.md)",
  );
  const posed = tileCentre(UNIT_TILE.col, UNIT_TILE.row);
  for (const unit of before.surge) {
    const now = unitOf(after, unit.id);
    assertEqual(
      now.x,
      posed.x,
      `the x unit ${unit.id} was standing at, its motion held off across the ` +
        `press (specs/screens.md)`,
    );
    assertEqual(
      now.y,
      posed.y,
      `the y unit ${unit.id} was standing at, its motion held off across the ` +
        `press (specs/screens.md)`,
    );
    assertEqual(
      now.hp,
      unit.hp,
      `the hp unit ${unit.id} was carrying across the press (specs/screens.md)`,
    );
  }
});
