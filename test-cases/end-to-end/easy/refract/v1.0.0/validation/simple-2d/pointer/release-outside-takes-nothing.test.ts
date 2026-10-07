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
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  pointOutsideEveryTarget,
  resetTo,
  targetById,
  targetCenter,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the title untouched when the release lands off the target", async () => {
  await resetTo(h);

  const item = targetCenter(targetById(h.snapshot(), "menu-2"));
  const away = pointOutsideEveryTarget(h.snapshot().targets);

  h.debug.pointerDown(item.x, item.y);
  h.debug.pointerMove(away.x, away.y);
  h.debug.pointerUp();
  await h.advance(1);

  assertEqual(
    h.snapshot().screen,
    "title",
    "a release outside the armed target takes nothing " +
      "(specs/controls.md, Operating a screen with the pointer)",
  );
  assertEqual(
    h.snapshot().menuIndex,
    2,
    "and the highlight stays where the press put it",
  );
  captureStill(h, "title");
});
