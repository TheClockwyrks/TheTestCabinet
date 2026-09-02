// presentation/bolt-effect-at-hitbox — the bolt sprite is drawn over the circle
// a live Ember bolt hits with, and nowhere after.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The weapon effects"): "bolt
// | Ember | assets/sprites/effects/ember.png | one sprite | 16 x 16 | the
// bolt's circle, for its life", and "Each is produced on the canvas its row
// states and scaled in code to the live shape, which areaMul and later levels
// grow, so the effect's drawn extent is the hitbox's extent on every tick it is
// drawn." specs/weapons.md ("Ember") fixes the shape: "A bolt is a circle of
// radius", and ("Shapes and overlap") that a circle is "a center and a radius",
// so its extent is the full diameter. specs/state.md has the snapshot report
// that radius: "radius: its collision radius, the level table's value times the
// area multiplier in force when it was fired". A projectile's sprite "is drawn
// centered on its circle, upright or turned to its velocity as you choose"
// (specs/assets.md), so the check reads the box the blit covered rather than
// its corners.
//
// THE WORLD. An isolated playing run (`isolate`): nothing on the field, no
// weapon held, every driver switch off. One Ember bolt is posed through
// `spawnProjectile` clear of the lamplighter with no velocity, which
// specs/instrumentation.md gives "the figures the weapon would give a
// projectile fired on this tick", and `effectMotion` stays off so it holds the
// position and velocity it was posed with for its whole life.
//
// WHAT IS READ. On every tick the bolt is in the snapshot, the blit of
// `ember.png` nearest the point the camera formula gives its center: its center
// is that point and its box is the bolt's own diameter. Then the ticks after
// the bolt is gone, on which no `ember.png` is blitted at all.
//
// TOLERANCE. DRAWN_POINT_TOLERANCE (1 unit) on the drawn center and
// DRAWN_EXTENT_TOLERANCE (2 units) on each extent, the case's tolerances for a
// bitmap a build may snap to whole device pixels. A bolt is 16 units across, so
// an effect drawn at its produced canvas against a grown hitbox, or left at
// the lamplighter, misses by far more.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { EMBER_LEVELS, ticksFor } from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  projectilesOf,
  spawnProjectileAt,
  type Harness,
} from "../harness";
import { circleOf, watchLife } from "./effects";

/** Where the bolt is posed: clear of the lamplighter and inside the view. */
const POSED_AT = { x: 240, y: -120 };

/** The ticks its duration gives it, with the sweep's two ticks of slack. */
const BOUND = ticksFor(EMBER_LEVELS[0].duration) + 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the bolt sprite over its circle for as long as the bolt is live", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the frames are drawn on");
  spawnProjectileAt(h, "ember", POSED_AT.x, POSED_AT.y, 0, 0, 0);
  assertLength(
    projectilesOf(h.snapshot(), "ember"),
    1,
    "the Ember bolts posed through the surface",
  );

  await captureReplay(h, "effect", async () => {
    await h.tick(1);
    await watchLife(
      h,
      "ember",
      (snapshot) => {
        const bolt = projectilesOf(snapshot, "ember")[0];
        return bolt === undefined ? undefined : circleOf(bolt);
      },
      "the Ember bolt",
      BOUND,
    );
  });
});
