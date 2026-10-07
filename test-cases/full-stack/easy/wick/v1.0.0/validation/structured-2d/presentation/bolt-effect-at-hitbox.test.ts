// presentation/bolt-effect-at-hitbox — Ember's bolt sprite is painted over the
// bolt's circle, for exactly as long as the bolt is in the world.
//
// WHERE THE FIGURES COME FROM. `specs/assets.md`, "The weapon effects": the
// bolt is one produced sprite at `assets/sprites/effects/ember.png`, drawn over
// "the bolt's circle, for its life", and each effect is "scaled in code to the
// live shape ... so the effect's drawn extent is the hitbox's extent on every
// tick it is drawn". `specs/weapons.md`, Ember: "A bolt is a circle of
// `radius`", and `specs/state.md` reports that circle's centre and radius on
// the projectile, so its extent across is twice its radius.
//
// Nothing here hard-codes the circle: the trace reads the bolt's own centre and
// radius off the snapshot on every tick, and the frame that tick drew must
// carry `ember.png` there, at that extent. The bound is `EXTENT_TOL` (4 units)
// on the extent and `SPRITE_TOL` (2 units) on the centre — the rounding a build
// that lands its destination rectangle on whole device pixels picks up. A bolt
// drawn at the produced canvas's fixed `16 x 16` whatever the radius, or left
// behind after the bolt expires, sits outside.
//
// THE WORLD, AND WHY. An isolated world holding nothing at all, with one bolt
// POSED through `spawnProjectile`, which `specs/instrumentation.md` gives "its
// figures the ones the weapon would give a projectile fired on this tick" — so
// no enemy has to be standing anywhere for Ember to have a target, and no
// second bolt can arrive. Its velocity is zero and `effectMotion` is off, so
// the bolt holds one place for its whole life and the only thing that ends it
// is its own `ttl`, which `specs/weapons.md` sets to the level-1 `duration` of
// `2.0` seconds.

import { afterEach, beforeEach, it } from "vitest";
import { EMBER_LEVELS } from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  placeProjectile,
  projectileById,
  type Harness,
  type WickSnapshot,
} from "../harness";
import {
  assertDrawnOverShape,
  circleShape,
  traceEffect,
  type Shape,
} from "./effects";
import { effectFiles } from "./sprites";

/** Where the bolt is posed: clear of the lamplighter and inside the view. */
const AT = { x: 240, y: -140 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws ember.png over the bolt's circle for the whole of its life", async () => {
  isolate(h);
  const id = placeProjectile(
    h,
    "ember",
    AT.x,
    AT.y,
    0,
    0,
    EMBER_LEVELS[0].pierce,
  );

  const locate = (snapshot: WickSnapshot): Shape | null => {
    const bolt = projectileById(snapshot, id);
    return bolt === undefined ? null : circleShape(bolt);
  };

  const trace = await captureReplay(h, "effect", () =>
    traceEffect(h, locate, { maxTicks: 200 }),
  );

  assertDrawnOverShape(h, trace, effectFiles("ember"), "Ember bolt");
});
