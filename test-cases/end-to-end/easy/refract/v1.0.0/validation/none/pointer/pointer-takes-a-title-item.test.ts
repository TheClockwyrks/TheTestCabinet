// Refract — pointer/pointer-takes-a-title-item: a press and release inside one
// title item's target takes it.
//
// specs/controls.md: a release inside the target the press armed takes that
// target, and taking `menu-<i>` does what `confirm` with the highlight at `i`
// does. HOW TO PLAY is the third item, so this is the whole pointer path for
// operating a menu, asserted against the screen the same choice reaches from
// the keyboard.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  pressRelease,
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

it("opens the how-to screen from a press and release on HOW TO PLAY", async () => {
  await h.debug.reset();
  await h.advance(1);

  const item = targetCenter(targetById(await h.snapshot(), "menu-2"));
  await pressRelease(h, item);

  assertEqual(
    (await h.snapshot()).screen,
    "howto",
    "a release inside the armed menu-2 target takes it, as confirm does " +
      "(specs/controls.md, Operating a screen with the pointer)",
  );
  await captureStill(h, "howto");
});
