// sprites/sprites-carry-content — no produced sprite is a blank canvas.
//
// `specs/assets.md` has every sprite drawn with `draw` "on a small transparent
// straight-alpha canvas", and names what each has to read as — a component as its
// type and its tier, a blocker as dead, a Load type as its own type. A file of
// the right name and the right size with nothing on it satisfies every other
// point in this category and none of that, so this is the point that opens each
// one and looks.
//
// THE BAR. A twentieth of the canvas carrying more than an alpha of `8`. It is
// deliberately far below anything a drawn sprite reaches — a `40 x 40` mount
// clears it with `80` opaque pixels — because what it is for is telling a drawing
// from an empty canvas, and `specs/assets.md` fixes no coverage a sprite must
// meet. The alpha floor is there because a straight-alpha canvas cleared to
// transparent black is not always exactly zero.

import { it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  standComponent,
} from "../harness";
import { COMPONENT_TYPES } from "../constants";
import { coverage, decode, everySprite } from "./png";

/** Above this alpha, a pixel was drawn on. */
const FLOOR = 8;
/** How much of its canvas a produced sprite has to have something on. */
const LEAST = 1 / 20;

it("has something drawn on every produced sprite", async () => {
  for (const sprite of everySprite()) {
    assertGreaterThanOrEqual(
      coverage(decode(sprite), FLOOR),
      LEAST,
      `the fraction of assets/${sprite.path} carrying more than an alpha of ` +
        `${FLOOR}`,
    );
  }

  const h = await createHarness();
  try {
    await openYard(h);
    let col = 6;
    for (const type of COMPONENT_TYPES) {
      await standComponent(h, type, 5, col, 10);
      col += 3;
    }
    await h.debug.clearSelection();
    await h.advance(1);
    await captureStill(h, "sheet");
  } finally {
    await h.dispose();
  }
});
