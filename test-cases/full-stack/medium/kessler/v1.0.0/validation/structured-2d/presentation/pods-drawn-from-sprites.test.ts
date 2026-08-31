// presentation/pods-drawn-from-sprites — a falling pod is painted from its
// kind's own produced sprite.
//
// specs/assets.md: "Each pod sprite is drawn on its falling pod", one produced
// file per kind — `sprites/pods/widen.png`, `narrow.png`, `multiball.png`,
// `shield.png`, `pierce.png` — and "The five pod kinds are told apart from
// each other at 24 pixels, in flight". Under this engine a blit's id is the
// served asset path, so each falling pod is read for an image draw centered on
// it that carries its own kind's file, which is exactly "each kind shows its
// own image in flight".
//
// The world is five pods and nothing else, one per kind, posed on an empty
// radius where nothing catches or touches them while the frame is read.

import { afterEach, beforeEach, it } from "vitest";
import { assertNotNull, assertTrue } from "../assert";
import { POD_KINDS, POD_FALL_SPEED, SPRITE_PATHS, TICK_DT } from "../constants";
import {
  captureStill,
  isolate,
  openHarness,
  polarToXy,
  spawnPodPolar,
  type Harness,
} from "../harness";
import { CLEAR_RADIUS, SPRITE_ATTRIBUTION_UNITS, spriteNear } from "./sprites";

/** The five posed angles, one pod per kind, well apart around the planet. */
const THETAS = [18, 90, 162, 234, 306] as const;

/** The five kinds. */
const KINDS = POD_KINDS;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("paints each falling pod from its own kind's produced sprite", async () => {
  isolate(h);
  for (let i = 0; i < KINDS.length; i += 1) {
    spawnPodPolar(h, KINDS[i], CLEAR_RADIUS, THETAS[i]);
  }

  const blits = await h.frameBlits();
  captureStill(h, "pods");

  // The read frame ran one tick, so each pod fell one tick's worth inward.
  const fallenRadius = CLEAR_RADIUS - POD_FALL_SPEED * TICK_DT;
  for (let i = 0; i < KINDS.length; i += 1) {
    const at = polarToXy(fallenRadius, THETAS[i]);
    const id = spriteNear(h, blits, at.x, at.y, SPRITE_ATTRIBUTION_UNITS);
    assertNotNull(id, `an image draw centered on the falling ${KINDS[i]} pod`);
    assertTrue(
      (id as string).endsWith(SPRITE_PATHS.pods[KINDS[i]]),
      `the image on the ${KINDS[i]} pod is the produced ` +
        `${SPRITE_PATHS.pods[KINDS[i]]}; saw ${String(id)}`,
    );
  }
});
