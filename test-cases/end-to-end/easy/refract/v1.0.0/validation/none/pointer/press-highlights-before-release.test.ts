// Refract — pointer/press-highlights-before-release: a press moves the highlight
// to the target it lands in, before any release.
//
// specs/controls.md: a press highlights and arms. That is what gives a
// touchscreen the feedback a mouse gets from hovering, since a finger produces
// no hover at all — the press is the only chance the player has to see which
// item their release will take.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  targetById,
  targetCenter,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("highlights the pressed item while the press is still held", async () => {
  await h.debug.reset({ seed: 1 });
  await h.advance(1);
  assertEqual((await h.snapshot()).menuIndex, 0, "the title opens with menuIndex 0");

  const item = targetCenter(targetById(await h.snapshot(), "menu-1"));
  await h.debug.pointerDown(item.x, item.y);
  await h.advance(1);

  assertEqual(
    (await h.snapshot()).menuIndex,
    1,
    "the press alone moves the highlight to menu-1 " +
      "(specs/controls.md, Operating a screen with the pointer)",
  );
  assertEqual((await h.snapshot()).screen, "title", "and takes nothing until the release");
  assertEqual((await h.snapshot()).pointer.down, true, "the press is still held");
  await captureStill(h, "menu");
});
