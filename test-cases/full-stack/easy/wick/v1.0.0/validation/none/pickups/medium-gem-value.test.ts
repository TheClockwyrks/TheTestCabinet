// pickups/medium-gem-value — a medium gem is worth 3 experience.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Gems") gives the tier table:
// "| `medium` | `3` |", under "`GEM_VALUES` gives the experience each grants",
// and "Attraction and flight" gives the gain: "a gem whose center is at most
// `COLLECT_RADIUS` from the lamplighter's center is collected on that tick: it
// is removed, and `xp` rises by `GEM_VALUES[tier] × xpMul`, a real number.
// `xpMul` is `1` with no Soot held." So one small gem collected with no Soot
// raises `xp` by exactly `GEM_VALUES.medium` (`3`).
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing dropped, and no slot held. Soot is the only thing that
// scales a gain and no passive is held, so the multiplier is `1` and the gain
// this check reads is the tier's own figure. `isolate` holds `progression` with
// the rest, so "No gain is spent: `xp` rises as gems are collected and stands
// however high it climbs" (specs/instrumentation.md) and no threshold is
// crossed to open an overlay on top of the reading. The gem is placed at the lamplighter's
// center and collected by one real tick, which is the only path experience
// arrives by: the tick attracts it (`0` is at most `pickupRadius`), moves it
// nowhere, and collects it (`0` is at most `COLLECT_RADIUS`).
//
// THE TOLERANCE. `xp` is "a real number", so the gain is read within
// `FLOAT_TOL`; the gem's removal is a count, read exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { FLOAT_TOL, GEM_VALUES } from "../constants";
import {
  captureStill,
  collectGem,
  createHarness,
  isolate,
  type Harness,
} from "../harness";

/** The tier this check reads, and the experience specs/world.md gives it. */
const TIER = "medium" as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises xp by exactly 3 when a medium gem is collected", async () => {
  const opened = await isolate(h);
  assertEqual(
    opened.run.passives.length,
    0,
    "the passives held, so xpMul is 1",
  );

  const after = await collectGem(h, TIER);
  await captureStill(h, "medium");

  assertEqual(after.run.gems.length, 0, "the gems left after the tick");
  assertNear(
    after.run.xp - opened.run.xp,
    GEM_VALUES[TIER],
    FLOAT_TOL,
    "the experience the medium gem granted",
  );
});
