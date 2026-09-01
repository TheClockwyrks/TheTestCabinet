// passives/soot-xp-mul — Soot multiplies the experience a gem grants by
// `1 + SOOT_XP_PER_LEVEL` per level.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` gives the term and the
// formula: `SOOT_XP_PER_LEVEL` is `0.1`, and
// "xpMul = 1 + SOOT_XP_PER_LEVEL × soot", so Soot 2 is `1.2`. The Experience
// section applies it: "The experience a collected gem grants is
// `GEM_VALUES[tier]` times `xpMul`, a real number added to `xp` on the tick
// the gem is collected." `GEM_VALUES.medium` is `3` (`specs/world.md`, Gems),
// so a medium gem adds `3.6`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding Soot 2 alone, with
// `xp` posed to `0` and one medium gem placed at the lamplighter's center: a
// gem "at most `pickupRadius` from the lamplighter's center becomes
// attracted", and after it moves "a gem whose center is at most
// `COLLECT_RADIUS` from the lamplighter's center is collected on that tick"
// (`specs/world.md`, Attraction and flight), so one tick collects it. The
// isolated run sits at `ISOLATE_LEVEL`, whose `xpToNext` is far above `3.6`,
// so the gain crosses no threshold and `xp` is read as it stands. Every driver
// switch is off, so no kill drops another gem.
//
// THE TOLERANCE. `REAL_EPS` on `xp`, one gem value times one multiplier; the
// unscaled figure, `3`, is six tenths away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { GEM_VALUES, REAL_EPS, xpMul } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  placeGem,
  type Harness,
} from "../harness";

/** The Soot level held: `xpMul` `1.2`. */
const SOOT = 2;

/** The experience a medium gem grants under Soot 2: `3 × 1.2 = 3.6`. */
const GAIN = GEM_VALUES.medium * xpMul(SOOT);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("adds 3.6 to xp when a medium gem is collected under Soot 2", async () => {
  isolate(h);
  holdPassive(h, "soot", SOOT);
  h.debug.setXp(0);
  const { player } = h.snapshot().run;
  const gem = placeGem(h, "medium", player.x, player.y);

  const collected = await advanceTicks(h, 1);
  captureStill(h, "xp");

  assertEqual(
    collected.run.gems.filter((g) => g.id === gem).length,
    0,
    "the gem after the tick that collected it (specs/world.md, Attraction and flight)",
  );
  assertNear(
    collected.run.xp,
    GAIN,
    REAL_EPS,
    "xp after collecting a medium gem under Soot 2 (specs/passives.md, Experience)",
  );
});
