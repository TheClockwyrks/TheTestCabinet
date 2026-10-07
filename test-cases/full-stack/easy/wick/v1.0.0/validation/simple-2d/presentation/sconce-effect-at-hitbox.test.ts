// presentation/sconce-effect-at-hitbox — a frame of the sconce sheet is drawn
// over the circle a live sconce hits with, and nowhere after.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The weapon effects"):
// "sconce | Sconce | assets/sprites/effects/sconce/0.png to 3.png | a sheet of
// 4, spinning | 24 x 24 | the sconce's circle, for its life", and "Each is
// produced on the canvas its row states and scaled in code to the live shape,
// which areaMul and later levels grow, so the effect's drawn extent is the
// hitbox's extent on every tick it is drawn." specs/weapons.md ("Sconce") fixes
// the shape: "A sconce is a circle of radius", and ("Shapes and overlap") that
// a circle is "a center and a radius", so its extent is the full diameter.
// specs/state.md has the snapshot report that radius. WHICH frame of the sheet
// is shown belongs to the point about the spin; this one holds every frame of
// it to the same box.
//
// THE WORLD. An isolated playing run (`isolate`): nothing on the field, no
// weapon held, every driver switch off. One sconce is posed through
// `spawnProjectile` clear of the lamplighter, with the velocity
// specs/instrumentation.md requires of a sconce ("a zero velocity is invalid
// for sconce") and the infinite pierce specs/weapons.md gives one, and
// `effectMotion` stays off, so it holds the position and velocity it was posed
// with rather than decelerating and returning while the effect is read.
//
// WHAT IS READ. On every tick the sconce is in the snapshot, the blit under
// `sprites/effects/sconce/` nearest the point the camera formula gives its
// center: its center is that point and its box is the sconce's own diameter.
// Then the ticks after the sconce is gone, on which no frame of the sheet is
// blitted at all.
//
// TOLERANCE. DRAWN_POINT_TOLERANCE (1 unit) on the drawn center and
// DRAWN_EXTENT_TOLERANCE (2 units) on each extent, the case's tolerances for a
// bitmap a build may snap to whole device pixels. A sconce is 24 units across,
// so an effect drawn at any other scale, or left at the launch point, misses by
// far more.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { INFINITE_PIERCE, SCONCE_LEVELS, ticksFor } from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  projectilesOf,
  spawnProjectileAt,
  type Harness,
} from "../harness";
import { circleOf, watchLife } from "./effects";

/** Where the sconce is posed, and the velocity a sconce must carry. */
const POSED_AT = { x: -200, y: -160 };
const SPEED = SCONCE_LEVELS[0].speed;

/** The ticks its duration gives it, with the sweep's two ticks of slack. */
const BOUND = ticksFor(SCONCE_LEVELS[0].duration) + 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a sconce frame over its circle for as long as the sconce is live", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the frames are drawn on");
  spawnProjectileAt(
    h,
    "sconce",
    POSED_AT.x,
    POSED_AT.y,
    SPEED,
    0,
    INFINITE_PIERCE,
  );
  assertLength(
    projectilesOf(h.snapshot(), "sconce"),
    1,
    "the sconces posed through the surface",
  );

  await captureReplay(h, "effect", async () => {
    await h.tick(1);
    await watchLife(
      h,
      "sconce",
      (snapshot) => {
        const sconce = projectilesOf(snapshot, "sconce")[0];
        return sconce === undefined ? undefined : circleOf(sconce);
      },
      "the sconce",
      BOUND,
    );
  });
});
