// Wick — clock/chest-ticks-nothing: the chest overlay ticks nothing.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/ui.md` ("What advances on each screen"): "`levelup`, `chest`,
//     `paused` | Nothing. The world beneath holds exactly the tick it was at."
//   - `specs/progression.md` ("The level-up overlay"): "the simulation does not
//     tick while it is open, so the world behind it is frozen exactly as that
//     tick left it"; and ("The chest overlay"): "The simulation does not tick
//     while the overlay is open".
//   - `specs/overview.md` ("Units, ticks, the world, and the camera"): "Only
//     the `playing` screen ticks; the level-up and chest overlays and every
//     other screen tick nothing".
//   - `specs/instrumentation.md` ("Snapshot shape"): `run` carries the tick,
//     every entity, every timer (`spawnTimer`, each enemy's `contactCooldown`
//     and `age`, each projectile's and zone's `ttl` and re-hit entries), and
//     every weapon's `cooldown`.
//
// WHAT IS READ. A busy night is posed with every autonomous system running, the
// tick that opens each overlay is run, and sixty frames are delivered on the
// overlay. The whole of `run` after those frames must equal the whole of `run`
// the opening tick left, field for field: the tick, every enemy, projectile,
// zone, gem, and pickup, every timer, and every cooldown. Two sections, one per
// overlay, each from a fresh pose.
//
// WHY THE NIGHT IS POSED AS IT IS. A frozen empty night would prove nothing, so
// the night has everything a tick would move: a moth chasing under
// `enemyMotion`, a held Ember firing under `weaponFire` whose bolt flies under
// `effectMotion`, a puddle counting its `ttl`, an attracted gem in flight, and
// the director's own timer counting under `spawning`. The switches stay on
// during the sixty frames, so a build that ticked under an overlay would move
// something. The overlays are reached the way the spec says they open: a
// queued level-up and a chest collected at the lamplighter's center, each on a
// real tick.
//
// TOLERANCE. None: the spec says the world holds "exactly the tick it was at",
// and `run` is compared structurally.
//
// The other overlay is `clock/levelup-ticks-nothing`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  enable,
  holdWeapon,
  isolate,
  openChest,
  spawnEnemyAt,
  spawnGemAt,
  type Harness,
} from "../harness";

/** How many frames are delivered on the overlay: one second of them. */
const FROZEN_FRAMES = 60;

/** Where the moth starts: well clear of the lamplighter, closing at 100 u/s. */
const MOTH_X = 300;

/** Where the puddle lies: off the lamplighter, with its `ttl` counting. */
const PUDDLE_X = 100;
const PUDDLE_Y = 100;

/**
 * Where the gem starts: inside the base `PICKUP_RADIUS` (48) so it is attracted
 * on the opening tick and is mid-flight when the overlay opens.
 */
const GEM_X = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** Pose a night with every autonomous system running and something for each. */
function poseBusyNight(): void {
  isolate(h);
  spawnEnemyAt(h, "moth", MOTH_X, 0);
  spawnGemAt(h, "small", GEM_X, 0);
  h.debug.spawnPuddle("oil-splash", PUDDLE_X, PUDDLE_Y);
  holdWeapon(h, "ember");
  enable(
    h,
    "spawning",
    "enemyMotion",
    "enemyContact",
    "weaponFire",
    "effectMotion",
  );
}

it("holds the whole run still under the chest overlay", async () => {
  poseBusyNight();
  const opened = await openChest(h);
  assertEqual(opened.screen, "chest", "the overlay the tick opened");
  await h.tick(FROZEN_FRAMES);
  const held = h.snapshot();
  captureStill(h, "frozen");

  assertEqual(held.screen, "chest", "screen after frames on chest");
  assertDeepEqual(held.run, opened.run, "run after frames on chest");
});
