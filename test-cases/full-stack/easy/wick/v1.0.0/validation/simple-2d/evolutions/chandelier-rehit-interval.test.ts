// Wick — evolutions/chandelier-rehit-interval: each Chandelier lantern re-hits
// an enemy it overlaps once every `LANTERN_REHIT`.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/evolutions.md` ("Chandelier"): "Each lantern is a touching effect
//     with re-hit interval `LANTERN_REHIT` (`0.5`), timed per lantern per
//     enemy." The fixed row has damage `25`, orbit `120`, radius `20`.
//   - `specs/weapons.md` ("Persistent effects"): "A touching effect ... damages
//     an enemy on any tick the two overlap, at most once per re-hit interval
//     per effect per enemy."
//   - `specs/world.md` ("Timers"): "An interval of `s` seconds anywhere in this
//     specification is likewise `round(s × TICK_HZ)` ticks", so `0.5` seconds
//     is 30 ticks; ("One tick"), phase 6: "every re-hit entry counts down"
//     before the hits, and "every projectile and zone hits, this tick's new
//     ones included, a new one hitting at the position it was created at", so
//     the lantern hits on the tick the set is placed and again 30 ticks later.
//   - `specs/evolutions.md` ("Chandelier"): lantern `i` is placed "at angle
//     `i × 360 / amount`", so with amount `4` one lantern starts at `0`
//     degrees, the point `orbit` along `+x` of the lamplighter's center.
//   - `specs/weapons.md` ("Shapes and overlap"): "Two circles overlap when the
//     distance between their centers is less than the sum of their radii"; a
//     hound is a circle of radius `18` with HP `120` (`specs/enemies.md`), so a
//     hound centered on that lantern overlaps it and outlasts three hits of 25.
//   - `specs/instrumentation.md` (The driver switches): with `effectMotion` off
//     "every lantern holds its angle. `ttl` and every re-hit entry still count,
//     and hits still resolve."
//
// WHAT IS READ. The hound's `hp` after each of 61 ticks from the pose, as the
// list of ticks on which it fell: exactly 1, 31, and 61. A build that re-hits
// every tick, never, or a tick early or late produces a different list.
//
// WHY THE NIGHT IS POSED AS IT IS. Chandelier alone and one hound standing on
// the point the `0`-degree lantern is placed at, so the overlap holds for every
// tick read and the other three lanterns, 169 units away or more, cannot reach
// it. Every driver switch is off: `effectMotion` holds the lantern on the
// hound, `enemyMotion` holds the hound, `enemyContact` keeps it off the
// lamplighter, and `weaponFire` is not needed, since the placement and the hits
// are gated by neither.
//
// TOLERANCE. `FIGURE_TOLERANCE` on each hp reading, exact arithmetic on stated
// figures. None on the ticks, which the interval rule fixes to whole counts.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertWithin } from "../assert";
import {
  CHANDELIER_STATS,
  ENEMIES,
  FIGURE_TOLERANCE,
  LANTERN_REHIT,
  ticksFor,
} from "../constants";
import {
  captureReplay,
  createHarness,
  enemyById,
  pointAt,
  present,
  spawnEnemyAt,
  type Harness,
} from "../harness";
import { poseEvolved } from "./evolved";
import { chandelierLanterns } from "./chandelier";

/** The enemy the lantern is held on: HP 120, radius 18. */
const PROBE = "hound";

/** The angle lantern 0 of the set is placed at: `0 × 360 / amount`. */
const START_ANGLE = 0;

/** The ticks between one hit and the next: round(0.5 × 60). */
const REHIT_TICKS = ticksFor(LANTERN_REHIT);

/** The ticks watched from the pose: the placing hit and two re-hits. */
const WATCH_TICKS = 1 + 2 * REHIT_TICKS;

/** The ticks a hit is due on: 1, 31, and 61. */
const EXPECTED = [1, 1 + REHIT_TICKS, 1 + 2 * REHIT_TICKS];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("damages the hound on ticks 1, 31 and 61 and on no tick between", async () => {
  const { player } = poseEvolved(h, "chandelier");
  const at = pointAt(player, CHANDELIER_STATS.orbit, START_ANGLE);
  const hound = spawnEnemyAt(h, PROBE, at.x, at.y);
  assertWithin(
    present(enemyById(h.snapshot(), hound), "the posed hound").hp,
    ENEMIES[PROBE].hp,
    FIGURE_TOLERANCE,
    "the posed hound's hp",
  );

  const seen = await captureReplay(h, "rehit", () => h.trace(WATCH_TICKS));

  assertEqual(
    chandelierLanterns(seen[0]).length,
    CHANDELIER_STATS.amount,
    "Chandelier lanterns after the placing tick",
  );

  const falls: number[] = [];
  let held = ENEMIES[PROBE].hp;
  seen.forEach((snapshot, index) => {
    const tick = index + 1;
    const now = present(
      enemyById(snapshot, hound),
      `the hound after tick ${tick}`,
    );
    if (now.hp < held) falls.push(tick);
    held = now.hp;
  });

  assertDeepEqual(falls, EXPECTED, "the ticks on which the hound's hp fell");
  assertWithin(
    held,
    ENEMIES[PROBE].hp - EXPECTED.length * CHANDELIER_STATS.damage,
    FIGURE_TOLERANCE,
    `the hound's hp after tick ${WATCH_TICKS}, three hits of 25 in`,
  );
});
