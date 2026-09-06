// Refract — pointer/touch-takes-a-title-item: a touch works the title menu
// exactly as a mouse does.
//
// specs/controls.md: a mouse, a pen, and a finger all drive the pointer and the
// game reads them the same way, so the identical press and release driven from
// a touch reaches the identical screen. The device the state reports is checked
// alongside it, because a build that quietly reports every pointer as a mouse
// has not carried the device through the path a touch actually takes.

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

it("opens the how-to screen from a touch press and release", async () => {
  await h.debug.reset();
  await h.advance(1);

  const item = targetCenter(targetById(await h.snapshot(), "menu-2"));
  await pressRelease(h, item, item, "touch");

  assertEqual(
    (await h.snapshot()).screen,
    "howto",
    "a touch takes menu-2 exactly as a mouse does (specs/controls.md)",
  );
  assertEqual(
    (await h.snapshot()).pointer.device,
    "touch",
    "and the state reports the device that drove it (specs/state.md)",
  );
  await captureStill(h, "howto");
});
