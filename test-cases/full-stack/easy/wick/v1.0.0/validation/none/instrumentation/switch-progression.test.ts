// Wick — instrumentation/switch-progression: with `setProgression(false)` a
// gain that reaches the threshold spends no level, and with the switch back on
// the next gain spends it.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "The driver
// switches"): "`setProgression(on)` | `progression` | Experience gained is
// spent on levels as `specs/progression.md` states: `xp` falls by
// `xpToNext(level)`, `level` rises, and a level-up is queued. | No gain is
// spent: `xp` rises as gems are collected and stands however high it climbs,
// and `level` and `pendingLevelUps` hold where they are." specs/progression.md:
// "While the `progression` driver switch ... is on, after every gain, while
// `xp >= xpToNext(level)`: `xp` falls by `xpToNext(level)`, `level` rises by
// `1`, and one level-up is queued in `pendingLevelUps`", with
// `xpToNext(1) = XP_BASE` (`5`), and "While the switch is off no gain is spent."
// A small gem is worth `GEM_VALUES.small` (`1`), and `xpMul` is `1` with no
// Soot held.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night at level `1` with `xp`
// posed one small gem short of the threshold, so a single collection reaches
// exactly `XP_BASE` and the switch decides whether it is spent. Each gem is
// collected the real way, placed at the lamplighter's center and taken by one
// tick, which is the only path experience arrives by. No passive is held, so
// the multiplier is `1`.
//
// THE TOLERANCE. `xp` is "a real number", so each reading is `FLOAT_TOL`; the
// level and the queue are counts, read exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { FLOAT_TOL, GEM_VALUES, XP_BASE } from "../constants";
import {
  captureStill,
  collectGem,
  createHarness,
  isolate,
  type Harness,
} from "../harness";

/** The tier each gain is made of: `GEM_VALUES.small` is `1`. */
const TIER = "small" as const;

/** Experience posed one small gem short of `xpToNext(1)`. */
const POSED_XP = XP_BASE - GEM_VALUES[TIER];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("spends no level while off, and spends the standing experience once on", async () => {
  const opened = await isolate(h);
  assertEqual(
    opened.progression,
    false,
    "the progression switch an isolated night holds",
  );
  assertEqual(opened.run.level, 1, "the level an isolated night stands at");
  await h.debug.setXp(POSED_XP);

  const held = await collectGem(h, TIER);
  await captureStill(h, "held");
  assertNear(held.run.xp, XP_BASE, FLOAT_TOL, "the experience the gain left");
  assertEqual(held.run.level, 1, "the level after a gain made while off");
  assertEqual(
    held.run.pendingLevelUps,
    0,
    "the level-ups queued by a gain made while off",
  );
  assertEqual(held.screen, "playing", "the screen the held gain left");

  await h.debug.setProgression(true);
  const spent = await collectGem(h, TIER);
  await captureStill(h, "spent");

  assertEqual(spent.run.level, 2, "the level after the gain made while on");
  assertNear(
    spent.run.xp,
    XP_BASE + GEM_VALUES[TIER] - XP_BASE,
    FLOAT_TOL,
    "the experience carried into the new level",
  );
  assertEqual(
    spent.run.pendingLevelUps,
    1,
    "the level-ups queued by the gain made while on",
  );
});
