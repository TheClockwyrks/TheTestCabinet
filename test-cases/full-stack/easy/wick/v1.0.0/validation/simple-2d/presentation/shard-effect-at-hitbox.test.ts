// presentation/shard-effect-at-hitbox — the shard sprite is drawn over the
// circle a live shard hits with, and nowhere after.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The weapon effects"):
// "shard | Shard | assets/sprites/effects/shard.png | one sprite | 16 x 16 |
// the shard's circle, for its life", and "Each is produced on the canvas its
// row states and scaled in code to the live shape, which areaMul and later
// levels grow, so the effect's drawn extent is the hitbox's extent on every
// tick it is drawn." specs/weapons.md ("Shard") fixes the shape: "A shard is a
// circle of radius", and ("Shapes and overlap") that a circle is "a center and
// a radius", so its extent is the full diameter. specs/state.md has the
// snapshot report that radius.
//
// THE WORLD. An isolated playing run (`isolate`): nothing on the field, no
// weapon held, every driver switch off. One shard is posed through
// `spawnProjectile` clear of the lamplighter with no velocity and the infinite
// pierce specs/weapons.md gives a shard, and `effectMotion` stays off so it
// neither travels nor bounces off the view's edges while the effect is read.
//
// WHAT IS READ. On every tick the shard is in the snapshot, the blit of
// `shard.png` nearest the point the camera formula gives its center: its center
// is that point and its box is the shard's own diameter. Then the ticks after
// the shard is gone, on which no `shard.png` is blitted at all.
//
// TOLERANCE. DRAWN_POINT_TOLERANCE (1 unit) on the drawn center and
// DRAWN_EXTENT_TOLERANCE (2 units) on each extent, the case's tolerances for a
// bitmap a build may snap to whole device pixels. A shard is 16 units across,
// so an effect drawn at any other scale, or left at the lamplighter, misses by
// far more.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { INFINITE_PIERCE, SHARD_LEVELS, ticksFor } from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  projectilesOf,
  spawnProjectileAt,
  type Harness,
} from "../harness";
import { circleOf, watchLife } from "./effects";

/** Where the shard is posed: clear of the lamplighter and inside the view. */
const POSED_AT = { x: 200, y: 160 };

/** The ticks its duration gives it, with the sweep's two ticks of slack. */
const BOUND = ticksFor(SHARD_LEVELS[0].duration) + 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the shard sprite over its circle for as long as the shard is live", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the frames are drawn on");
  spawnProjectileAt(h, "shard", POSED_AT.x, POSED_AT.y, 0, 0, INFINITE_PIERCE);
  assertLength(
    projectilesOf(h.snapshot(), "shard"),
    1,
    "the shards posed through the surface",
  );

  await captureReplay(h, "effect", async () => {
    await h.tick(1);
    await watchLife(
      h,
      "shard",
      (snapshot) => {
        const shard = projectilesOf(snapshot, "shard")[0];
        return shard === undefined ? undefined : circleOf(shard);
      },
      "the shard",
      BOUND,
    );
  });
});
