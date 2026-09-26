// contact/hp-may-fall-below-zero — a hit may take hp below 0.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Health and recovery"): "`hp`
// is a real number at most `maxHp`; a hit may take it below `0`, which ends the
// run." The hit rule subtracts and clamps nothing: "`hp` falls by
// `max(MIN_DAMAGE_TAKEN, enemy damage - armor)`". A hound's damage is 20
// (specs/enemies.md — "Hound | `hound` | 120 | 110 | 20 | 18"), so from an `hp`
// of 2 its hit leaves `2 - 20 = -18`. The end screen "keep[s] the run that just
// ended" (specs/state.md), and the snapshot reports "the run that just ended on
// `fallen` and `dawn`" (specs/instrumentation.md), so the reading after the tick
// is -18 whichever screen the tick left the game on.
//
// THE DRIVE. An isolated night with `enemyContact` on and `enemyMotion` off,
// `hp` posed to 2 through `setHp`, and one hound 5 units from the lamplighter's
// center, well inside its radius 18 plus `PLAYER_RADIUS` 12. Its cooldown is the
// 0 it spawned with, so it hits on the first tick. Recovery is 0 with no Tinder
// held. One tick is run, and `hp` is read.
//
// THE TOLERANCE. `FLOAT_TOL`: `2 - 20` is exact. The nearest wrong answer, an
// `hp` clamped at 0, is 18 away.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { ENEMIES, FLOAT_TOL } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  placeEnemyNear,
  player,
  type Harness,
} from "../harness";

/** The health posed before the hit: short of a hound's 20. */
const POSED_HP = 2;

/** How far from the center the hound is posed: well inside 18 + 12. */
const HOUND_OFFSET = 5;

/** `2 - 20`. */
const EXPECTED_HP = POSED_HP - ENEMIES.hound.damage;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads hp -18 after a hound's 20 lands on an hp of 2", async () => {
  await isolate(h, { on: ["enemyContact"] });
  await h.debug.setHp(POSED_HP);
  await placeEnemyNear(h, "hound", HOUND_OFFSET, 0);

  const after = await h.step(1);

  // The screen the tick left, with the run's health carried below zero.
  // Captured before the assertion, so a failing build leaves the picture that
  // shows why.
  await captureStill(h, "below");

  assertNear(
    player(after).hp,
    EXPECTED_HP,
    FLOAT_TOL,
    "hp after a hound's hit on an hp of 2",
  );
});
