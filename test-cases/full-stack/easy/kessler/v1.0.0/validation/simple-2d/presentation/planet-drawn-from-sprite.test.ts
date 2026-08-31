// presentation/planet-drawn-from-sprite — the planet is painted from the
// produced planet sprite, centered on the stage center, not a disc drawn in
// code.
//
// specs/assets.md: "The planet sprite is drawn centered on the stage center",
// the produced file `sprites/planet.png` under the engine's asset root; its
// closing section keeps the planet OFF the drawn-in-code list — "The planet,
// every pod, and every ball frame on screen is a produced sprite". Under this
// engine a blit's id is the served asset path, so the reading is both halves
// at once: an image draw centered on (500, 500), and that image being the
// produced planet file.
//
// The world is the playing field with nothing spawned in it: the planet is
// part of the field on every playing frame, and an empty field means the only
// thing whose center can sit on the stage center is the planet.

import { afterEach, beforeEach, it } from "vitest";
import { assertNotNull, assertTrue } from "../assert";
import { PLANET_SPRITE, STAGE_CX, STAGE_CY } from "../constants";
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

afterEach(() => {
  h?.dispose();
});

it("paints the planet from its produced sprite, centered on the stage center", async () => {
  isolate(h);

  const blits = await h.frameBlits();
  captureStill(h, "planet");

  const id = spriteNear(h, blits, STAGE_CX, STAGE_CY, SPRITE_ATTRIBUTION_UNITS);
  assertNotNull(
    id,
    "the image draw centered on the stage center on a playing frame",
  );
  assertTrue(
    (id as string).endsWith(PLANET_SPRITE),
    `the image on the planet is the produced ${PLANET_SPRITE}; saw ${String(id)}`,
  );
});
