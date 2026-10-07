// presentation/slash-effect-at-hitbox — the slash sprite is drawn over the
// rectangle a live slash hits with, and nowhere after.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The weapon effects"):
// "slash | Taper | assets/sprites/effects/taper.png | one sprite | 120 x 40 |
// the width x height rectangle, for SLASH_FLASH (0.1) seconds", and "Each is
// produced on the canvas its row states and scaled in code to the live shape,
// which areaMul and later levels grow, so the effect's drawn extent is the
// hitbox's extent on every tick it is drawn." specs/weapons.md ("Taper") fixes
// the shape: "A slash is a rectangle of width x height", and specs/state.md
// fixes what the snapshot reports of it: "width, height: the full extent of a
// slash's rectangle, after the area multiplier ... present on a slash".
//
// THE WORLD. An isolated playing run (`isolate`): nothing on the field, no
// other weapon held, every driver switch off but the one the firing needs.
// Taper alone is held at level 1, whose amount is 1, so exactly one slash
// exists, and its cooldown is posed to 0 so the next tick fires it.
//
// WHAT IS READ. On every tick the slash is in the snapshot, the blit of
// `taper.png` nearest the point the camera formula gives the zone's center: its
// center is that point and its box is the zone's own width and height. Then the
// ticks after the zone is gone, on which no `taper.png` is blitted at all.
//
// TOLERANCE. DRAWN_POINT_TOLERANCE (1 unit) on the drawn center and
// DRAWN_EXTENT_TOLERANCE (2 units) on each extent, the case's tolerances for a
// bitmap a build may snap to whole device pixels. The slash is 120 x 40 units,
// so an effect drawn at its produced canvas size against a grown hitbox, or
// centered on the lamplighter rather than on the rectangle, misses by tens.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { SLASH_FLASH, TAPER_LEVELS, ticksFor } from "../constants";
import {
  armWeapon,
  captureReplay,
  createHarness,
  holdWeapon,
  isolate,
  zonesOfKind,
  type Harness,
} from "../harness";
import { rectangleOf, watchLife } from "./effects";

/** The level held: amount 1, so the firing tick creates one slash. */
const LEVEL = 1;

/** The ticks the flash gives the shape, with the sweep's two ticks of slack. */
const BOUND = ticksFor(SLASH_FLASH) + 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the slash sprite over its rectangle for as long as the shape is live", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the frames are drawn on");
  assertEqual(TAPER_LEVELS[LEVEL - 1].amount, 1, "Taper's amount at level 1");
  const slot = holdWeapon(h, "taper", LEVEL);
  armWeapon(h, slot);

  await captureReplay(h, "effect", async () => {
    const fired = await h.tick(1);
    assertLength(
      zonesOfKind(fired, "slash"),
      1,
      "the slashes the firing tick created",
    );
    await watchLife(
      h,
      "taper",
      (snapshot) => {
        const zone = zonesOfKind(snapshot, "slash")[0];
        return zone === undefined ? undefined : rectangleOf(zone);
      },
      "the Taper slash",
      BOUND,
    );
  });
});
