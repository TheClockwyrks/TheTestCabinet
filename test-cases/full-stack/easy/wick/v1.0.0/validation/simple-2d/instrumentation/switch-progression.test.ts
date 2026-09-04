// instrumentation/switch-progression — with `setProgression(false)`, the
// experience a collected gem carries reaches `xp` and is spent on no level;
// with the switch back on the next gain crosses the threshold and queues its
// level-up.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, "The driver
// switches", `progression`: on, "Experience gained is spent on levels as
// `specs/progression.md` states: `xp` falls by `xpToNext(level)`, `level`
// rises, and a level-up is queued"; off, "No gain is spent: `xp` rises as gems
// are collected and stands however high it climbs, and `level` and
// `pendingLevelUps` hold where they are." The same section fixes that
// collection itself is gated by neither switch: "a collected gem's experience
// still reaches `xp`". specs/progression.md: the threshold is `xpToNext(level)`
// and `XP_BASE` (`5`) is the first level's, and `GEM_VALUES` gives a `large`
// gem `10`.
//
// THE POSE. An isolated run at level `1`, a large gem on the lamplighter's own
// center so one tick collects it. With the switch off, `xp` reads the gem's
// whole `10`, past the level-1 threshold of `5`, while `level` and
// `pendingLevelUps` hold. Then the switch on and a second identical gem: the
// gain is spent, so `level` rises and a level-up is queued.
//
// THE TOLERANCE. `FIGURE_TOLERANCE` on `xp`, which the specification states as
// arithmetic over real values; none on `level` or `pendingLevelUps`, which are
// whole counts.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertWithin } from "../assert";
import { FIGURE_TOLERANCE, GEM_VALUES, XP_BASE } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  isolate,
  spawnGemAt,
  type Harness,
} from "../harness";

/** The tier collected: its 10 experience is past the level-1 threshold of 5. */
const TIER = "large";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Put one gem of `TIER` on the lamplighter's center, where a tick collects it. */
function gemUnderfoot(on: Harness): void {
  const { player } = on.snapshot().run;
  spawnGemAt(on, TIER, player.x, player.y);
}

it("holds the level while off and spends the next gain when on", async () => {
  const posed = isolate(h, { level: 1 });
  assertGreaterThan(
    GEM_VALUES[TIER],
    XP_BASE,
    "the gem's experience against the level-1 threshold",
  );
  gemUnderfoot(h);

  const held = await h.tick(1);
  captureStill(h, "held");

  assertWithin(
    held.run.xp,
    posed.run.xp + GEM_VALUES[TIER],
    FIGURE_TOLERANCE,
    "xp after the gain with progression off",
  );
  assertEqual(held.run.level, posed.run.level, "level with progression off");
  assertEqual(
    held.run.pendingLevelUps,
    0,
    "the level-ups queued with progression off",
  );

  enable(h, "progression");
  gemUnderfoot(h);
  const after = await h.tick(1);
  captureStill(h, "spent");

  assertGreaterThan(
    after.run.level,
    held.run.level,
    "level after the gain with progression on",
  );
  assertGreaterThan(
    after.run.pendingLevelUps,
    0,
    "the level-ups queued with progression on",
  );
});
