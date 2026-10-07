// presentation/puddle-effect-at-hitbox — the puddle sprite is drawn over the
// circle a live puddle pulses over, and nowhere after.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The weapon effects"):
// "puddle | Oil Splash | assets/sprites/effects/oil-splash.png | one sprite |
// 100 x 100 | the puddle's circle, for its life", and "Each is produced on the
// canvas its row states and scaled in code to the live shape, which areaMul and
// later levels grow, so the effect's drawn extent is the hitbox's extent on
// every tick it is drawn." specs/weapons.md ("Oil Splash") fixes the shape: "A
// puddle is a circle of radius that stays where it landed for duration seconds
// and then vanishes", and ("Shapes and overlap") that a circle is "a center and
// a radius", so its extent is the full diameter. specs/state.md has the
// snapshot report that radius.
//
// THE WORLD. An isolated playing run (`isolate`): nothing on the field, no
// weapon held, every driver switch off, so nothing is in the puddle to pulse
// over and the puddle simply lies there. One puddle is posed through
// `spawnPuddle` clear of the lamplighter, which specs/instrumentation.md gives
// the weapon's own radius, damage, and duration.
//
// WHAT IS READ. On every tick the puddle is in the snapshot, the blit of
// `oil-splash.png` nearest the point the camera formula gives its center: its
// center is that point and its box is the puddle's own diameter. Then the ticks
// after the puddle is gone, on which no `oil-splash.png` is blitted at all.
// specs/assets.md leaves the pulse's own look to the build ("a puddle's picture
// on the tick it pulses differs from its picture on the tick before"), so what
// is read here is the box and the center alone, which hold on every tick.
//
// TOLERANCE. DRAWN_POINT_TOLERANCE (1 unit) on the drawn center and
// DRAWN_EXTENT_TOLERANCE (2 units) on each extent, the case's tolerances for a
// bitmap a build may snap to whole device pixels. A level-1 puddle is 100 units
// across, so an effect drawn at any other scale misses by tens.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { OIL_SPLASH_LEVELS, ticksFor } from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  spawnPuddleAt,
  zonesOfKind,
  type Harness,
} from "../harness";
import { circleOf, watchLife } from "./effects";

/** Where the puddle lands: clear of the lamplighter and inside the view. */
const POSED_AT = { x: 260, y: 120 };

/** The ticks its duration gives it, with the sweep's two ticks of slack. */
const BOUND = ticksFor(OIL_SPLASH_LEVELS[0].duration) + 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the puddle sprite over its circle for as long as the puddle is live", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the frames are drawn on");
  spawnPuddleAt(h, "oil-splash", POSED_AT.x, POSED_AT.y);
  assertLength(
    zonesOfKind(h.snapshot(), "puddle"),
    1,
    "the puddles posed through the surface",
  );

  await captureReplay(h, "effect", async () => {
    await h.tick(1);
    await watchLife(
      h,
      "oil-splash",
      (snapshot) => {
        const puddle = zonesOfKind(snapshot, "puddle")[0];
        return puddle === undefined ? undefined : circleOf(puddle);
      },
      "the Oil Splash puddle",
      BOUND,
    );
  });
});
