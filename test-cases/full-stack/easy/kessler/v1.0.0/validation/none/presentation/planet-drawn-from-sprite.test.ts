// presentation/planet-drawn-from-sprite — the planet is painted with a bitmap
// centered on the stage center, not a disc drawn in code.
//
// specs/assets.md: "The planet sprite is drawn centered on the stage center",
// produced with `draw` and listed under "The sprites"; its closing section
// keeps the planet OFF the drawn-in-code list — "The planet, every pod, and
// every ball frame on screen is a produced sprite". What is read is whether an
// image draw's center landed on the stage center; a disc built from paths has
// no blit there. WHICH file was painted is not asked here: an engineless
// build is free to name and inline the images it loads, so a blit only
// carries identity, and the produced-file bar is the assets category's.
//
// The world is the playing field with nothing spawned in it: the planet is
// part of the field on every playing frame, and an empty field means the only
// thing whose center can sit on (500, 500) is the planet.

import { afterEach, beforeEach, it } from "vitest";
import { assertNotNull } from "../assert";
import { CENTER_X, CENTER_Y } from "../constants";
import {
  captureStill,
  isolate,
  openHarness,
  spriteNear,
  type Harness,
} from "../harness";
import { SPRITE_ATTRIBUTION_UNITS } from "./sprites";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("paints the planet with an image draw centered on the stage center", async () => {
  await isolate(h);

  const blits = await h.frameBlits();
  await captureStill(h, "planet");

  assertNotNull(
    spriteNear(h, blits, CENTER_X, CENTER_Y, SPRITE_ATTRIBUTION_UNITS),
    "the image draw centered on the stage center on a playing frame",
  );
});
