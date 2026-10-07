// presentation/pods-drawn-from-sprites — a falling pod is painted from its
// kind's own sprite.
//
// specs/assets.md: "Each pod sprite is drawn on its falling pod", one produced
// file per kind — `widen.png`, `narrow.png`, `multiball.png`, `shield.png`,
// `pierce.png` — and "The five pod kinds are told apart from each other at 24
// pixels, in flight". So each falling pod must carry an image draw, and the
// five kinds must carry five DIFFERENT images. A blit's id is identity alone —
// two blits carry the same id exactly when they painted the same file — which
// is precisely what "each kind shows its own image" needs: a blit on every
// pod, and five pairwise-distinct ids across the kinds.
//
// The world is five pods and nothing else, one per kind, posed on an empty
// radius where nothing catches or touches them while the frame is read.

import { afterEach, beforeEach, it } from "vitest";
import { assertNotNull, assertNotEqual } from "../assert";
import { pointAt, POD_FALL_SPEED, POD_KINDS, TICK_DT } from "../constants";
import {
  captureStill,
  isolate,
  openHarness,
  spawnPodPolar,
  spriteNear,
  type Harness,
} from "../harness";
import { CLEAR_RADIUS, SPRITE_ATTRIBUTION_UNITS } from "./sprites";

/** The five posed angles, one pod per kind, well apart around the planet. */
const THETAS = [18, 90, 162, 234, 306] as const;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("paints each falling pod from its own kind's image", async () => {
  await isolate(h);
  for (let i = 0; i < POD_KINDS.length; i += 1) {
    await spawnPodPolar(h, POD_KINDS[i], CLEAR_RADIUS, THETAS[i]);
  }

  const blits = await h.frameBlits();
  await captureStill(h, "pods");

  // The read frame ran one tick, so each pod fell one tick's worth inward.
  const fallenRadius = CLEAR_RADIUS - POD_FALL_SPEED * TICK_DT;
  const ids: (string | null)[] = [];
  for (let i = 0; i < POD_KINDS.length; i += 1) {
    const at = pointAt(fallenRadius, THETAS[i]);
    const id = spriteNear(h, blits, at.x, at.y, SPRITE_ATTRIBUTION_UNITS);
    assertNotNull(
      id,
      `an image draw centered on the falling ${POD_KINDS[i]} pod`,
    );
    ids.push(id);
  }
  for (let a = 0; a < ids.length; a += 1) {
    for (let b = a + 1; b < ids.length; b += 1) {
      assertNotEqual(
        ids[a],
        ids[b],
        `the image on the ${POD_KINDS[a]} pod against the image on the ` +
          `${POD_KINDS[b]} pod`,
      );
    }
  }
});
