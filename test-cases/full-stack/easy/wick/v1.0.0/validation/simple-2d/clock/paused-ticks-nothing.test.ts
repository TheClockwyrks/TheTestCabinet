// Wick — clock/paused-ticks-nothing: the pause screen ticks nothing.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/ui.md` ("What advances on each screen"): "`levelup`, `chest`,
//     `paused` | Nothing. The world beneath holds exactly the tick it was at."
//   - `specs/ui.md` (`paused`): "The world held still, with the HUD, under
//     `PAUSED_TEXT`".
//   - `specs/instrumentation.md` (`setScreen`): "`paused` | `playing` | Exactly
//     as `pause` does; the accumulator is discarded as on any frame that
//     leaves `playing`."
//   - `specs/instrumentation.md` ("Snapshot shape"): `run` carries the tick,
//     every enemy, projectile, zone, and gem, and every timer.
//
// WHAT IS READ. A busy night is posed with every autonomous system running and
// ticked once so everything is mid-motion, the pause is entered through the
// surface, and sixty frames are delivered on `paused`. The whole of `run` after
// those frames must equal the whole of `run` the pause left, field for field.
//
// WHY THE NIGHT IS POSED AS IT IS. A frozen empty night would prove nothing, so
// the night has everything a tick would move: a moth chasing under
// `enemyMotion`, a held Ember firing under `weaponFire` whose bolt flies under
// `effectMotion`, a puddle counting its `ttl`, an attracted gem in flight, and
// the director's own timer counting under `spawning`. The switches stay on
// during the sixty frames, so a build that ticked under the pause would move
// something. The pause is entered through `setScreen("paused")`, which the spec
// fixes as exactly the pause transition, so the menu key is no part of this
// point.
//
// TOLERANCE. None: the spec says the world holds "exactly the tick it was at",
// and `run` is compared structurally.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  enable,
  holdWeapon,
  isolate,
  spawnEnemyAt,
  spawnGemAt,
  type Harness,
} from "../harness";

/** How many frames are delivered on the pause: one second of them. */
const FROZEN_FRAMES = 60;

/** Where the moth starts: well clear of the lamplighter, closing at 100 u/s. */
const MOTH_X = 300;

/** Where the puddle lies: off the lamplighter, with its `ttl` counting. */
const PUDDLE_X = 100;
const PUDDLE_Y = 100;

/**
 * Where the gem starts: inside the base `PICKUP_RADIUS` (48) so it is attracted
 * on the first tick and is mid-flight when the pause is entered.
 */
const GEM_X = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds the whole run still under the pause", async () => {
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
  // One tick so the bolt is in flight, the gem is attracted, and every timer
  // has started counting, before the pause catches them all mid-motion.
  await h.tick(1);

  h.debug.setScreen("paused");
  const paused = h.snapshot();
  assertEqual(paused.screen, "paused", "the screen the pose entered");
  await h.tick(FROZEN_FRAMES);
  const held = h.snapshot();
  captureStill(h, "frozen");

  assertEqual(held.screen, "paused", "screen after frames on paused");
  assertDeepEqual(held.run, paused.run, "run after frames on paused");
});
