// presentation/dart-effect-at-hitbox — the dart sprite is drawn over the circle
// a live Pin dart hits with, and nowhere after.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The weapon effects"): "dart
// | Pin | assets/sprites/effects/pin.png | one sprite | 12 x 12 | the dart's
// circle, for its life", and "Each is produced on the canvas its row states and
// scaled in code to the live shape, which areaMul and later levels grow, so the
// effect's drawn extent is the hitbox's extent on every tick it is drawn."
// specs/weapons.md ("Pin") fixes the shape: "A dart is a circle of radius", and
// ("Shapes and overlap") that a circle is "a center and a radius", so its
// extent is the full diameter. specs/state.md has the snapshot report that
// radius. A projectile's sprite "is drawn centered on its circle, upright or
// turned to its velocity as you choose" (specs/assets.md), so the check reads
// the box the blit covered rather than its corners.
//
// THE WORLD. An isolated playing run (`isolate`): nothing on the field, no
// weapon held, every driver switch off. One Pin dart is posed through
// `spawnProjectile` clear of the lamplighter with no velocity, which
// specs/instrumentation.md gives "the figures the weapon would give a
// projectile fired on this tick", and `effectMotion` stays off so it holds the
// position it was posed with for its whole life.
//
// WHAT IS READ. On every tick the dart is in the snapshot, the blit of
// `pin.png` nearest the point the camera formula gives its center: its center
// is that point and its box is the dart's own diameter. Then the ticks after
// the dart is gone, on which no `pin.png` is blitted at all.
//
// TOLERANCE. DRAWN_POINT_TOLERANCE (1 unit) on the drawn center and
// DRAWN_EXTENT_TOLERANCE (2 units) on each extent, the case's tolerances for a
// bitmap a build may snap to whole device pixels. A dart is 12 units across, so
// an effect drawn at any other scale, or left at the lamplighter, misses by far
// more.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { PIN_LEVELS, ticksFor } from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  projectilesOf,
  spawnProjectileAt,
  type Harness,
} from "../harness";
import { circleOf, watchLife } from "./effects";

/** Where the dart is posed: clear of the lamplighter and inside the view. */
const POSED_AT = { x: -240, y: 140 };

/** The ticks its duration gives it, with the sweep's two ticks of slack. */
const BOUND = ticksFor(PIN_LEVELS[0].duration) + 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the dart sprite over its circle for as long as the dart is live", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the frames are drawn on");
  spawnProjectileAt(
    h,
    "pin",
    POSED_AT.x,
    POSED_AT.y,
    0,
    0,
    PIN_LEVELS[0].pierce,
  );
  assertLength(
    projectilesOf(h.snapshot(), "pin"),
    1,
    "the Pin darts posed through the surface",
  );

  await captureReplay(h, "effect", async () => {
    await h.tick(1);
    await watchLife(
      h,
      "pin",
      (snapshot) => {
        const dart = projectilesOf(snapshot, "pin")[0];
        return dart === undefined ? undefined : circleOf(dart);
      },
      "the Pin dart",
      BOUND,
    );
  });
});
