// pickups/large-gem-value — a large gem is worth 10 experience.
//
// WHERE THE THRESHOLD COMES FROM. `specs/world.md` ("Gems") tabulates the
// three tiers under "`GEM_VALUES` gives the experience each grants", and the
// `large` row reads "| `large` | `10` |". ("Attraction and flight") is
// what turns that figure into a gain: "After it moves, a gem whose center is at
// most `COLLECT_RADIUS` from the lamplighter's center is collected on that
// tick: it is removed, and `xp` rises by `GEM_VALUES[tier] × xpMul`, a real
// number. `xpMul` is `1` with no Soot held." So one large gem collected with
// no Soot held raises `xp` by exactly `GEM_VALUES.large` (`10`), and a build
// that carries another tier's figure, or scales an unscaled multiplier in, is
// off by a whole unit of experience.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing else dropped, and no slot held. Soot is the only term
// that scales a gain (`specs/passives.md`) and no passive is held, so `xpMul`
// is `1` and the gain read here is the tier's own figure. `isolate` poses
// `ISOLATE_LEVEL` (`50`), whose `xpToNext` is `495`, so the gain crosses no
// threshold and no level-up overlay opens on top of the reading. The gem is
// posed on the lamplighter's own center and taken by one real tick, the only
// path experience arrives by: distance `0` is at most `pickupRadius`, so the
// tick attracts it; the flight step moves it nowhere; and `0` is at most
// `COLLECT_RADIUS`, so the same tick collects it. No key is pressed, so the
// lamplighter holds the origin throughout.
//
// THE TOLERANCE. `REAL_EPS` on the gain, which `specs/world.md` calls "a real
// number"; the tiers the specification distinguishes are whole numbers apart.
// The gem's removal is a count and is read exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { GEM_VALUES, REAL_EPS } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  type Harness,
} from "../harness";

/** The tier read here, and the experience `specs/world.md` gives it. */
const TIER = "large" as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("raises xp by exactly 10 when a large gem is collected", async () => {
  const opened = isolate(h);
  assertEqual(
    opened.run.passives.length,
    0,
    "the passives held, so xpMul is 1 (specs/passives.md, Soot)",
  );
  const at = opened.run.player;
  h.debug.spawnGem(TIER, at.x, at.y);

  const after = await advanceTicks(h, 1);
  captureStill(h, "large");

  assertEqual(
    after.run.gems.length,
    0,
    "the gems left after the tick that collected the large gem",
  );
  assertNear(
    after.run.xp - opened.run.xp,
    GEM_VALUES[TIER],
    REAL_EPS,
    "the experience a large gem granted (specs/world.md, Gems)",
  );
});
