// Wick — oil-splash/puddle-stays: a puddle stays where it landed while the
// lamplighter walks away.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Oil Splash"): "A puddle is a circle of `radius`
//     that stays where it landed for `duration` seconds and then vanishes."
//   - `specs/state.md` (`ZoneState`, `x`, `y`): "the center of the circle
//     ... A lantern and an aura are placed relative to the lamplighter every
//     tick, so their positions follow the lamplighter", which no other kind
//     does.
//   - `specs/instrumentation.md` (`setEffectMotion`, on): "Projectiles
//     integrate, lanterns revolve, shards bounce, and sconces decelerate",
//     which names no puddle: nothing moves a puddle whatever the switch holds.
//   - `specs/world.md` ("Movement"): the lamplighter moves on every tick a
//     movement action is held, at `moveSpeed`, which is what carries it away.
//
// WHAT IS READ. The puddle's `x` and `y` on the firing tick, and then on each
// of the 120 ticks the lamplighter walks right, followed by id: every reading
// is the landing point. The lamplighter's `x` after the walk is read higher
// than before it, which is what makes the readings a walk away and not a
// standstill. A build that places puddles relative to the lamplighter, as it
// places the aura, drags the puddle along and fails from the first walked
// tick.
//
// WHY THE NIGHT IS POSED AS IT IS. Oil Splash alone at level 1 on an empty
// field: Oil Splash needs no target. `weaponFire` is on for the firing tick
// and turned off after it, so the one puddle is the only zone for the walk;
// `effectMotion` is turned on for the walk, so a build that moves puddles
// under it is caught rather than excused. The walk is 120 ticks, inside the
// puddle's 150-tick life.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) on each reading of `x` and `y`, a
// stored figure read back. None on the count of ticks.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertWithin } from "../assert";
import { FIGURE_TOLERANCE, OIL_SPLASH_LEVELS, ticksFor } from "../constants";
import {
  captureReplay,
  createHarness,
  disable,
  enable,
  keysOf,
  present,
  zoneById,
  type Harness,
} from "../harness";
import { armOilSplash, fireOnce } from "./puddle";

/** The level held: any row serves, and row 1 is the acquisition row. */
const LEVEL = 1;

/** How long the lamplighter walks: two seconds, inside a level-1 puddle's life. */
const WALK_TICKS = 120;

/** The key held for the walk: the first code bound to `right`. */
const WALK_KEY = keysOf("right")[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads the puddle at its landing point on every tick of a walk away from it", async () => {
  assertGreaterThan(
    ticksFor(OIL_SPLASH_LEVELS[LEVEL - 1].duration),
    WALK_TICKS,
    "the puddle's life in ticks against the walk",
  );
  const { slot } = armOilSplash(h, LEVEL);
  const { after: fired, created } = await fireOnce(h, slot);
  const landed = present(created[0], "a puddle created on the firing tick");
  const landing = { x: landed.x, y: landed.y };
  const before = fired.run.player.x;

  disable(h, "weaponFire");
  enable(h, "effectMotion");
  const walked = await captureReplay(h, "stayed", async () => {
    h.holdKey(WALK_KEY);
    try {
      return await h.trace(WALK_TICKS);
    } finally {
      h.releaseKey(WALK_KEY);
    }
  });

  const last = walked[walked.length - 1];
  assertGreaterThan(
    last.run.player.x,
    before,
    "the lamplighter's x after the walk, against before it",
  );
  walked.forEach((snapshot, index) => {
    const tick = index + 1;
    const puddle = present(
      zoneById(snapshot, landed.id),
      `the puddle on walked tick ${tick}`,
    );
    assertWithin(
      puddle.x,
      landing.x,
      FIGURE_TOLERANCE,
      `the puddle's x on walked tick ${tick}`,
    );
    assertWithin(
      puddle.y,
      landing.y,
      FIGURE_TOLERANCE,
      `the puddle's y on walked tick ${tick}`,
    );
  });
});
