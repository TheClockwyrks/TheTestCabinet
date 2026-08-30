// Refract — pointer/release-outside-takes-nothing: a release outside the target
// the press armed takes nothing.
//
// specs/controls.md: only a release inside the armed target takes it. That is
// what lets a player who pressed the wrong item slide off it and let go without
// consequence, and it is the half of the gesture a build that acts on the press
// alone gets wrong. The release lands at the first stage point the build's own
// target list leaves free, so the check follows whatever layout the build chose
// rather than assuming a corner is empty.

import { afterEach, beforeEach, it } from "vitest";
import { STAGE_H, STAGE_W } from "../notation";
import { assertEqual, fail } from "../assert";
import {
  captureStill,
  createHarness,
  targetById,
  targetCenter,
  targetsOverlap,
  type Harness,
  type TargetSnapshot,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * A stage point inside no target on the screen, found rather than assumed: the
 * build owns its layout, so the release has to land somewhere the build itself
 * says is free.
 */
function pointOutsideEveryTarget(
  targets: readonly TargetSnapshot[],
): { x: number; y: number } {
  for (let y = 4; y < STAGE_H; y += 16) {
    for (let x = 4; x < STAGE_W; x += 16) {
      const probe = { id: "probe", x, y, w: 1, h: 1 };
      if (!targets.some((target) => targetsOverlap(target, probe))) {
        return { x, y };
      }
    }
  }
  return fail("a stage point inside no target", targets.map((t) => t.id));
}

it("leaves the title untouched when the release lands off the target", async () => {
  await h.debug.reset({ seed: 1 });
  await h.advance(1);

  const item = targetCenter(targetById(await h.snapshot(), "menu-2"));
  const away = pointOutsideEveryTarget((await h.snapshot()).targets);

  await h.debug.pointerDown(item.x, item.y);
  await h.debug.pointerMove(away.x, away.y);
  await h.debug.pointerUp();
  await h.advance(1);

  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "a release outside the armed target takes nothing " +
      "(specs/controls.md, Operating a screen with the pointer)",
  );
  assertEqual(
    (await h.snapshot()).menuIndex,
    2,
    "and the highlight stays where the press put it",
  );
  await captureStill(h, "title");
});
