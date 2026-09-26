// pickups/gem-collected-same-tick-as-drop — a gem dropped at the lamplighter is
// collected on the tick it dropped.
//
// WHERE THE THRESHOLD COMES FROM. `specs/world.md` ("One tick") orders the
// tick: phase 6, where "an enemy whose `hp` is at or below `0` dies: its drop
// and its bread or draft land at its center, at rest for this tick", and phase
// 9, "every gem within `pickupRadius` becomes attracted, every attracted gem
// that existed before this tick moves, and every gem within `COLLECT_RADIUS` is
// collected, this tick's drops and the gems a draft attracted on this tick
// included. A gem dropped on this tick is attracted and collected by the same
// tests as any other and takes its first flight step on the next tick." A moth
// killed on the lamplighter's own center therefore drops its gem at distance
// `0`, which is at most `PICKUP_RADIUS` (`48`) and at most `COLLECT_RADIUS`
// (`8`), so the same tick attracts and collects it: the snapshot that tick
// leaves holds no gem, and `xp` has risen by `GEM_VALUES.small` (`1`), the
// moth's tier in `specs/enemies.md`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing dropped, and no slot held, so no Soot scales the gain
// and no other kill lands in the tick that is read. The kill is a real one: a
// level-1 Oil Splash puddle posed on the moth's center overlaps it certainly,
// "pulses first on the next tick" whatever the driver switches hold, and "each
// pulse deals `damage` to every enemy overlapping it"
// (`specs/instrumentation.md`, `spawnPuddle`; `specs/weapons.md`, Oil Splash),
// so the moth's `hp`, posed to that row's `4`, reaches `0` on the one tick this
// check runs. The moth stands on the lamplighter's center, which is what puts
// the drop at distance `0`; `enemyContact` is off, so standing there costs no
// health and the run cannot end on that tick.
//
// THE TOLERANCE. `REAL_EPS` on the experience, "a real number"; the kill count
// and the gem count are whole and read exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import {
  ENEMIES,
  GEM_VALUES,
  OIL_SPLASH_LEVELS,
  REAL_EPS,
  type GemTier,
} from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  enable,
  isolate,
  placeEnemy,
  placePuddle,
  type Harness,
} from "../harness";

/** A level-1 Oil Splash puddle's damage, `4`, with no Wick held. */
const PULSE_DAMAGE = OIL_SPLASH_LEVELS[0].damage;

/** The tier `specs/enemies.md` gives a moth, and the experience it carries. */
const MOTH_TIER = ENEMIES.moth.gem as GemTier;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves no gem and raises xp by the moth's tier on the tick of the kill", async () => {
  // `drops` is the faculty this point is about — the gem a death leaves —
  // so it is the one switch turned back on (`specs/instrumentation.md`).
  isolate(h);
  enable(h, "drops");
  const opened = h.snapshot();
  const at = opened.run.player;
  const moth = placeEnemy(h, "moth", at.x, at.y);
  h.debug.setEnemyHp(moth, Math.min(PULSE_DAMAGE, ENEMIES.moth.hp));
  placePuddle(h, "oil-splash", at.x, at.y);

  const after = await advanceTicks(h, 1);
  captureStill(h, "same");

  assertEqual(after.run.kills, opened.run.kills + 1, "the kills the tick made");
  assertEqual(
    after.run.gems.length,
    0,
    "the gems left in the snapshot of the tick that dropped one at the lamplighter (specs/world.md, One tick, phase 9)",
  );
  assertNear(
    after.run.xp - opened.run.xp,
    GEM_VALUES[MOTH_TIER],
    REAL_EPS,
    "the experience the drop granted on its own tick",
  );
});
