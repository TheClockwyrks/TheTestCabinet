// Wick — passives/soot-xp-mul: Soot multiplies a gem's experience by
// `1 + 0.1` per level.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("The derived stats"):
// "`xpMul = 1 + SOOT_XP_PER_LEVEL × soot`" with `SOOT_XP_PER_LEVEL` (`0.1`),
// and ("Experience") "The experience a collected gem grants is
// `GEM_VALUES[tier]` times `xpMul`, a real number added to `xp` on the tick the
// gem is collected." `specs/world.md` ("Gems") gives `GEM_VALUES.medium` as
// `3`, so with Soot at level 2 a medium gem adds `3 × 1.2 = 3.6`.
//
// THE POSE. An isolated night with Soot 2 held through `setPassive` and one
// medium gem posed at the lamplighter's center through `spawnGem`, then the
// tick that collects it: `specs/world.md` (phase 9) collects "every gem within
// `COLLECT_RADIUS` ... this tick's drops ... included", and a gem at the center
// is inside `COLLECT_RADIUS` (`8`) at once. `isolate` leaves the run at level
// `50`, whose `xpToNext` is `495`, so the gain queues no level-up and `xp`
// stands where the gem left it. `xp` begins at the `0` a fresh run starts with,
// and every faculty stays held so nothing else drops a gem.
//
// TOLERANCE. `FLOAT_TOL` on the gain, a table figure times exactly `1.2`. The
// unscaled `3` is six tenths away.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { FLOAT_TOL, GEM_VALUES, xpMul } from "../constants";
import {
  captureStill,
  collectGem,
  createHarness,
  holdPassive,
  isolate,
  type Harness,
} from "../harness";

/** The Soot level held: `xpMul` `1.2`. */
const SOOT_LEVEL = 2;

/** The tier collected: `GEM_VALUES.medium` is `3`. */
const TIER = "medium" as const;

/** `3 × (1 + 0.1 × 2)`. */
const EXPECTED = GEM_VALUES[TIER] * xpMul({ soot: SOOT_LEVEL });

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("adds 3.6 to xp on collecting a medium gem with Soot 2 held", async () => {
  const opened = await isolate(h);
  await holdPassive(h, "soot", SOOT_LEVEL);

  const collected = await collectGem(h, TIER);
  await captureStill(h, "xp");

  assertNear(
    collected.run.xp - opened.run.xp,
    EXPECTED,
    FLOAT_TOL,
    "the xp a medium gem added with Soot 2 held",
  );
});
