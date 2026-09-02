// presentation/burst-effect-at-hitbox — a frame of the flare sheet is drawn
// over the circle a live burst fired over, and nowhere after.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The weapon effects"):
// "flare burst | Flare | assets/sprites/effects/flare/0.png to 5.png | a sheet
// of 6, played once | 128 x 128 | the burst's circle, for FLARE_FLASH (0.4)
// seconds", and "Each is produced on the canvas its row states and scaled in
// code to the live shape, which areaMul and later levels grow, so the effect's
// drawn extent is the hitbox's extent on every tick it is drawn." The same
// section is explicit about the size this reaches: "The burst is drawn at the
// full diameter of its circle, past the edges of the view where the circle
// reaches past them." specs/weapons.md ("Flare") fixes the shape: "every enemy
// within radius of the player's center takes damage", and specs/state.md that
// "a burst's radius is its Flare radius", so its extent is the full diameter of
// that circle. WHICH frame of the sheet is shown belongs to the point about the
// sheet playing once through; this one holds every frame of it to the same box.
//
// THE WORLD. An isolated playing run (`isolate`): nothing on the field, no
// other weapon held, every driver switch off but the one the firing needs.
// Flare "fires whether or not any enemy exists", so nothing has to stand in the
// blast. Flare alone is held at level 1 and its cooldown is posed to 0 so the
// next tick fires it; its 60-second cooldown puts the next firing far outside
// the sweep.
//
// WHAT IS READ. On every tick the burst zone is in the snapshot, the blit under
// `sprites/effects/flare/` nearest the point the camera formula gives its
// center: its center is that point and its box is the zone's own diameter,
// 1280 units at level 1, which reaches past the top and bottom of the view.
// Then the ticks after the zone is gone, on which no frame of the sheet is
// blitted at all.
//
// TOLERANCE. DRAWN_POINT_TOLERANCE (1 unit) on the drawn center and
// DRAWN_EXTENT_TOLERANCE (2 units) on each extent, the case's tolerances for a
// bitmap a build may snap to whole device pixels. A build that drew the burst
// at the sheet's produced canvas, or clipped it to the view, misses by
// hundreds.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { FLARE_FLASH, ticksFor } from "../constants";
import {
  armWeapon,
  captureReplay,
  createHarness,
  holdWeapon,
  isolate,
  zonesOfKind,
  type Harness,
} from "../harness";
import { circleOf, watchLife } from "./effects";

/** The level held; Flare ignores amount, so one burst fires. */
const LEVEL = 1;

/** The ticks the flash gives the shape, with the sweep's two ticks of slack. */
const BOUND = ticksFor(FLARE_FLASH) + 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a flare frame over the burst's circle for as long as the burst is live", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the frames are drawn on");
  const slot = holdWeapon(h, "flare", LEVEL);
  armWeapon(h, slot);

  await captureReplay(h, "effect", async () => {
    const fired = await h.tick(1);
    assertLength(
      zonesOfKind(fired, "burst"),
      1,
      "the bursts the firing tick fired",
    );
    await watchLife(
      h,
      "flare",
      (snapshot) => {
        const burst = zonesOfKind(snapshot, "burst")[0];
        return burst === undefined ? undefined : circleOf(burst);
      },
      "the Flare burst",
      BOUND,
    );
  });
});
