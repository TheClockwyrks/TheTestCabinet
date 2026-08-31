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
// THE TOLERANCE ON A UNIT'S POSITION, AND WHY IT IS NOT ZERO. The walker is under
// its own power, and the frame that resolves the press is a frame of the game: a
// build may legally resume and then advance within it, and may legally resolve the
// press on its next frame instead. `POSITION_TOLERANCE` is what that costs and no
// more — it is nowhere near the distance a restarted or re-spawned unit would move.
//
// THE PAUSE SCREEN IS POSED, NOT PRESSED FOR. How a player gets to it is
// `controls.esc-pauses` and `controls.pause-key`; `setScreen` runs no entry effect
// (specs/instrumentation.md), so what is graded here is the RESUME row alone.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, PAUSE_ITEMS, SURGE_DEFS } from "../../src/constants";
import { assertDeepEqual, assertEqual, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseTower,
  poseWalker,
  seconds,
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

/**
 * How far, in logical units, a walker may have moved across the press.
 *
 * A Mote covers `60` logical units a second (specs/surge.md), which is half a unit
 * in a frame of the suite's `120` Hz clock. Four frames of that is `2` units: the
 * frame the press is delivered on, the frame a build may resolve it on instead,
 * and two spare. A build that restarted the run or re-released the wave would
 * report the unit at its vent, hundreds of units away.
 */
const POSITION_TOLERANCE = 4 * seconds(1) * SURGE_DEFS.mote.speed;

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
  for (const tower of TOWERS) poseTower(h, tower.type, tower.col, tower.row);
  poseWalker(h, "mote", "left");
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
    })),
    before.towers.map((tower) => ({
      id: tower.id,
      type: tower.type,
      col: tower.col,
      row: tower.row,
      level: tower.level,
    })),
    "the towers standing on the floor the match was left with " +
      "(specs/screens.md)",
  );
  assertDeepEqual(
    after.surge.map((unit) => ({ id: unit.id, type: unit.type })),
    before.surge.map((unit) => ({ id: unit.id, type: unit.type })),
    "the surge on the floor the match was left with (specs/screens.md)",
  );
  for (const unit of before.surge) {
    const now = unitOf(after, unit.id);
    assertLessThanOrEqual(
      Math.hypot(now.x - unit.x, now.y - unit.y),
      POSITION_TOLERANCE,
      `how far unit ${unit.id} moved across the press, in logical units: ` +
        `the floor comes back exactly as it was left (specs/screens.md)`,
    );
  }
});
