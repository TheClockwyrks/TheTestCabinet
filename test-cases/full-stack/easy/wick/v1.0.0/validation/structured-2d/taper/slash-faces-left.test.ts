// Wick — taper/slash-faces-left: the slash extends toward −x while facing
// left.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Taper"): "Its near vertical edge is at the
//     player's `x`, it extends `width` in the facing direction". Row 1 of
//     `TAPER_LEVELS`: width 120.
//   - `specs/weapons.md` ("The nearest enemy"): "The facing direction is
//     `facing` from `specs/world.md`: `+x` for `"right"` and `−x` for
//     `"left"`."
//   - `specs/instrumentation.md` (`setFacing`): "Sets `facing` to `facing`,
//     `"left"` or `"right"`."
//   - `specs/weapons.md` ("Shapes and overlap"): a rectangle and a circle
//     overlap when the circle's center is less than its radius from the
//     rectangle's nearest point; a moth's radius is 10 (`specs/enemies.md`).
//
// THE DRIVE. An isolated run at the origin, `facing` posed to `"left"`, Taper
// at level 1 armed, `weaponFire` the one switch on, and two moths: one at
// (−100, 0), inside the rectangle from `x` −120 to 0, and one at (+100, 0),
// 100 units from that rectangle's nearest point. The firing tick runs once.
// The left moth is hit and the right one untouched. Facing right, the same
// pose reads the other way round, which `slash-geometry` decides.
//
// TOLERANCE. None on the outcomes; `REAL_EPS` on the untouched moth's `hp`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { REAL_EPS, TAPER_LEVELS } from "../constants";
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

/** The row under test: level 1, a 120 × 40 slash. */
const LEVEL = 1;
const ROW = TAPER_LEVELS[LEVEL - 1];

/** The probes, as offsets along `x` from the lamplighter's center. */
const LEFT_DX = -100;
const RIGHT_DX = 100;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("hits a moth 100 left of the player and misses one 100 right while facing left", async () => {
  if (!(-LEFT_DX < ROW.width)) {
    throw new Error("the left probe must sit inside the rectangle");
  }

  isolate(h);
  h.debug.setFacing("left");
  assertEqual(h.snapshot().run.player.facing, "left", "facing after the pose");
  const left = placeEnemyNear(h, "moth", LEFT_DX, 0);
  const right = placeEnemyNear(h, "moth", RIGHT_DX, 0);
  const before = h.snapshot();
  const hpLeft = hpOf(before, left);
  const hpRight = hpOf(before, right);
  armTaper(h, LEVEL);

  const after = await advanceTicks(h, 1);
  captureStill(h, "left");

  assertEqual(
    zonesOfKind(after, "slash").length,
    ROW.amount,
    "the slashes the firing tick created",
  );
  assertEqual(
    enemyOutcome(after, left, hpLeft),
    "hit",
    "the moth at (player.x − 100, player.y), in the facing direction",
  );
  assertEqual(
    enemyOutcome(after, right, hpRight),
    "untouched",
    "the moth at (player.x + 100, player.y), behind the player",
  );
  assertNear(
    hpOf(after, right),
    hpRight,
    REAL_EPS,
    "the right moth's hp after the firing tick",
  );
});
