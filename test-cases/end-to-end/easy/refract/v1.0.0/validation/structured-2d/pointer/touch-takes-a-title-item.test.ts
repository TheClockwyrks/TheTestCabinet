// Refract — pointer/touch-takes-a-title-item: a touch works the title menu
// exactly as a mouse does.
//
// specs/controls.md: a mouse, a pen, and a finger all drive the pointer and the
// game reads them the same way, so the identical press and release driven from
// a touch reaches the identical screen. The device the state reports is checked
// alongside it, because a build that quietly reports every pointer as a mouse
// has not carried the device through the path a touch actually takes.
//
// WHEN THE DEVICE IS READ. At the pose, before the frame that settles the
// screen. specs/state.md makes `state.pointer` the pointer as the game read it
// from its input, refreshed every update, and specs/instrumentation.md makes a
// posed touch reach the game's input path at the call — never the engine's own
// pointer — so a build that refreshes the mirror from the engine's pointer
// every update reports the engine's resting mouse one frame after the pose.
// The specification admits that design as it admits a mirror the game's own
// resolution writes; the two agree at the pose, where a posed touch and a posed
// mouse "differ only in the device the state reports". The gesture is driven
// inline rather than through `pressRelease` so the read can sit between the
// release and the frame.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
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

it("opens the how-to screen from a touch press and release", async () => {
  await resetTo(h);

  const item = targetCenter(targetById(h.snapshot(), "menu-2"));
  h.debug.pointerDown(item.x, item.y, "touch");
  h.debug.pointerUp("touch");
  assertEqual(
    h.snapshot().pointer.device,
    "touch",
    "the state reports the device that drove it (specs/state.md)",
  );
  await h.advance(1);

  assertEqual(
    h.snapshot().screen,
    "howto",
    "a touch takes menu-2 exactly as a mouse does (specs/controls.md)",
  );
  captureStill(h, "howto");
});
