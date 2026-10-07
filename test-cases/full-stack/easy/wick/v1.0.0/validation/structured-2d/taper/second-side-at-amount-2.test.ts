// Wick — taper/second-side-at-amount-2: with amount 2 a second slash fires
// on the same tick, mirrored to the opposite side of the player.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Taper"): "With amount `2` a second slash fires on
//     the same tick, mirrored to the opposite side of the player." Row 3 of
//     `TAPER_LEVELS`: width 120, height 40, amount 2.
//   - `specs/weapons.md` ("Taper"): "Its near vertical edge is at the
//     player's `x`, it extends `width` in the facing direction, and it is
//     centered vertically on the player's `y`"; mirrored, the second slash's
//     near edge is at the player's `x` and it extends `width` the other way.
//   - `specs/state.md` (`ZoneState`): "`x`, `y`: ... for a slash the center
//     of the rectangle", so facing right the two centers are at
//     `player.x ± width / 2` on `player.y`.
//   - `specs/weapons.md` ("Amount"): "A weapon's amount is the table amount
//     plus `amountBonus`", and no Mirror is held, so the amount is 2.
//
// THE DRIVE. An isolated run at the origin facing right, Taper at level 3
// armed, `weaponFire` the one switch on, and two moths at the two rectangle
// centers, (player.x + 60, player.y) and (player.x − 60, player.y). The
// firing tick runs once: two slashes, one centered on each side of the
// player, and both moths hit on that tick.
//
// TOLERANCE. `MOTION_EPS` on the two centers, each a position less or plus
// half a width; the counts and outcomes are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { MOTION_EPS, TAPER_LEVELS } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  placeEnemyNear,
  zonesOfKind,
  type Harness,
} from "../harness";
import { armTaper, enemyOutcome, hpOf } from "./slash";

/** The row under test: level 3, the first with amount 2. */
const LEVEL = 3;
const ROW = TAPER_LEVELS[LEVEL - 1];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates a slash on each side of the player and hits a moth on each", async () => {
  if (ROW.amount !== 2) {
    throw new Error("the row under test must carry amount 2");
  }
  const half = ROW.width / 2;

  const posed = isolate(h);
  assertEqual(posed.run.player.facing, "right", "the fresh run's facing");
  const { player } = posed.run;
  const ahead = placeEnemyNear(h, "moth", half, 0);
  const behind = placeEnemyNear(h, "moth", -half, 0);
  const before = h.snapshot();
  const hpAhead = hpOf(before, ahead);
  const hpBehind = hpOf(before, behind);
  armTaper(h, LEVEL);

  const after = await advanceTicks(h, 1);
  captureStill(h, "both");

  const slashes = zonesOfKind(after, "slash");
  assertEqual(slashes.length, 2, "the slashes the firing tick created");
  const centers = slashes.map((z) => z.x).sort((a, b) => a - b);
  assertNear(
    centers[0],
    player.x - half,
    MOTION_EPS,
    "the mirrored slash's center x, half a width behind the player",
  );
  assertNear(
    centers[1],
    player.x + half,
    MOTION_EPS,
    "the facing slash's center x, half a width ahead of the player",
  );
  for (const z of slashes) {
    assertNear(z.y, player.y, MOTION_EPS, `slash ${z.id}'s center y`);
  }
  assertEqual(
    enemyOutcome(after, ahead, hpAhead),
    "hit",
    "the moth on the facing side",
  );
  assertEqual(
    enemyOutcome(after, behind, hpBehind),
    "hit",
    "the moth on the mirrored side",
  );
});
