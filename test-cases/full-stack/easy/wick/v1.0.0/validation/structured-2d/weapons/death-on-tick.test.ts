// weapons/death-on-tick — an enemy whose hp is at or below 0 dies on that tick.
//
// THE SPEC LINE. `specs/weapons.md`, "Hits and death": "On any tick an enemy's
// `hp` is at or below `0` after the hits the enemy dies on that tick: the kill
// count rises by one, the enemy drops what `specs/enemies.md` lists for it".
// `specs/world.md`, phase 6: "an enemy whose `hp` is at or below `0` dies: its
// drop and its bread or draft land at its center, at rest for this tick", and
// under "Gems": "Every common enemy drops one gem of the tier
// `specs/enemies.md` lists for its type, at the enemy's position, on the tick
// it dies." A moth drops a `small` gem (`specs/enemies.md`).
//
// WHERE THE FIGURE COMES FROM. The threshold the rule fixes is `0`, and "at
// or below" makes `0` itself a death, so the pose lands the hit exactly on it:
// a moth posed to `4` hp, the level-1 Oil Splash row's damage
// (`specs/weapons.md`, "Oil Splash"), under one puddle of that damage. A build
// whose test is `hp < 0` leaves this moth alive and fails the point; one whose
// test is `hp <= 0` passes. Overkill is the same rule a step past its
// boundary, so the boundary is what is posed.
//
// THE POSE. One moth at `(200, 0)` with `setEnemyHp(id, 4)`, which takes "a
// real number above `0` and at most its `maxHp`" (`specs/instrumentation.md`),
// and an Oil Splash puddle posed at the moth's own center, whose `damage` is
// "that row's damage times the `damageMul` in force at the call" with no Wick
// held, so `4`. A posed puddle "pulses first on the next tick"
// (`specs/instrumentation.md`) and each pulse "deals `damage` to every enemy
// overlapping it", and the two centers coincide, so the pulse is certain.
// `enemyMotion` is held so the moth dies where it was posed; the moth stands
// `200` from the lamplighter, well past `pickupRadius` `48`, so its gem is not
// attracted or collected on the tick it lands; nothing else runs. The bread and
// draft draws are the tick's own and may leave a pickup beside the gem, which
// is nothing this point reads.
//
// WHAT IS READ. That tick's snapshot: the moth gone from `enemies`, `kills`
// one higher, and a `small` gem at the moth's center. Three faces of the one
// event the spec states for the tick.
//
// THE TOLERANCE. The counts are exact; the gem's position, copied from the
// moth's, is held to `REAL_EPS`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertUndefined } from "../assert";
import { ENEMIES, OIL_SPLASH_LEVELS, REAL_EPS } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  distance,
  enable,
  enemyById,
  isolate,
  placeEnemyNear,
  placePuddle,
  type Harness,
} from "../harness";

/** Where the moth stands: past `pickupRadius`, so its gem stays where it drops. */
const MOTH = { x: 200, y: 0 };

/** The level-1 puddle's damage, `4`, and the hp the moth is posed to. */
const DAMAGE = OIL_SPLASH_LEVELS[0].damage;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("removes a moth a hit takes to exactly 0 hp, counts the kill, and drops its gem where it died", async () => {
  if (!(DAMAGE > 0 && DAMAGE <= ENEMIES.moth.hp)) {
    throw new Error(
      "the posed hp must be above 0 and at most the moth's maxHp",
    );
  }
  isolate(h);
  // The gem a death leaves is half of what this point decides, so `drops` is
  // turned back on; everything else stays held.
  enable(h, "drops");
  const moth = placeEnemyNear(h, "moth", MOTH.x, MOTH.y);
  h.debug.setEnemyHp(moth, DAMAGE);
  const posed = h.snapshot();
  const before = enemyById(posed, moth);
  if (before === undefined) throw new Error("the posed moth is missing");
  assertNear(
    before.hp,
    DAMAGE,
    REAL_EPS,
    "the moth's hp as posed (specs/instrumentation.md, setEnemyHp)",
  );
  placePuddle(h, "oil-splash", before.x, before.y);

  const died = await captureReplay(h, "death", () => advanceTicks(h, 1));

  assertUndefined(
    enemyById(died, moth),
    "the moth in enemies on the tick its hp reached exactly 0 (specs/weapons.md, Hits and death)",
  );
  assertEqual(
    died.run.kills,
    posed.run.kills + 1,
    "kills on the tick the moth died (specs/weapons.md, Hits and death)",
  );
  const gems = died.run.gems.filter((gem) => gem.tier === ENEMIES.moth.gem);
  assertEqual(
    gems.length,
    1,
    "small gems on the field on the tick the moth died (specs/world.md, Gems)",
  );
  assertNear(
    distance(gems[0], before),
    0,
    REAL_EPS,
    "how far the gem lies from the center the moth died at (specs/world.md, Gems)",
  );
});
