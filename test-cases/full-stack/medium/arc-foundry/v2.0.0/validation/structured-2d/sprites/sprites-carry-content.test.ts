// sprites/sprites-carry-content — no produced sprite is a blank canvas.
//
// `specs/assets.md` has every sprite drawn with `draw` "on a small transparent
// straight-alpha canvas", and names what each has to read as — a component as its
// type and its tier, a blocker as dead, a Load type as its own type. A file of
// the right name and the right size with nothing on it satisfies every other
// point in this category and none of that, so this is the point that opens each
// one and looks.
//
// WHAT IS DECIDED. That the canvas is not blank: at least one of its pixels
// carries more than the decode floor. `specs/assets.md` fixes no coverage a sprite
// must meet — a thin projectile bolt on the padded canvas it fixes the size of and
// a sparse `16 x 16` icon are both conforming drawings — so how much of a canvas a
// sprite fills is the build's, and how good the drawing is is the reviewer's
// presentation rating.
//
// THE DECODE FLOOR. A straight-alpha canvas cleared to transparent black does not
// always come back exactly zero, so `8` is what a pixel has to carry before the
// decode counts it as drawn on rather than as cleared ground.
//
// THE STILL IS EVIDENCE ONLY. The verdict is read off the files above the
// drive, so the pose that puts the yard beside them is guarded: a build whose
// debug surface cannot take the pose loses the picture and keeps the point,
// and no still is recorded over the un-posed frame.

import { it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  standComponent,
} from "../harness";
import { COMPONENT_TYPES } from "../constants";
import { coverage, decode, everySprite } from "./png";

/** Above this alpha, a decoded pixel was drawn on rather than left cleared. */
const FLOOR = 8;

it("has something drawn on every produced sprite", async () => {
  for (const sprite of everySprite()) {
    assertGreaterThan(
      coverage(decode(sprite), FLOOR),
      0,
      `the fraction of assets/${sprite.path} carrying more than an alpha of ` +
        `${FLOOR}, so the canvas is drawn on rather than blank`,
    );
  }

  const h = await createHarness();
  try {
    openYard(h);
    let col = 6;
    for (const type of COMPONENT_TYPES) {
      standComponent(h, type, 5, col, 10);
      col += 3;
    }
    h.debug.clearSelection();
    await h.advance(1);
    captureStill(h, "sheet");
  } catch (error) {
    // Evidence only; the readings above carry the verdict.
    console.warn(
      `arc foundry: could not pose the still for \`sheet\`, so none is recorded: ${String(error)}`,
    );
  } finally {
    h.dispose();
  }
});
