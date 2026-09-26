// Refract — pointer/press-highlights-before-release: a press moves the highlight
// to the target it lands in, before any release.
//
// specs/controls.md: a press highlights and arms. That is what gives a
// touchscreen the feedback a mouse gets from hovering, since a finger produces
// no hover at all — the press is the only chance the player has to see which
// item their release will take.
//
// WHEN THE POINTER MIRROR IS READ. `state.pointer` is read at the pose, before
// a frame is advanced. specs/state.md makes it the pointer as the game read it
// from the runtime layer in the current frame, refreshed every update, and
// specs/instrumentation.md makes a posed press reach the game's input path at
// the call. A build that refreshes the mirror from the runtime layer's own
// pointer every update reports that pointer, up and mouse, one frame after a
// pose that layer never saw, and the specification admits that design as it
// admits a mirror the game's own resolution writes. The two agree at the pose,
// which is where the press being held is read; the highlight it left is read
// after a frame like every pose.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
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
  await h.debug.reset();
  await h.advance(1);
  assertEqual(
    (await h.snapshot()).menuIndex,
    0,
    "the title opens with menuIndex 0",
  );

  const item = targetCenter(targetById(await h.snapshot(), "menu-1"));
  await h.debug.pointerDown(item.x, item.y);
  // specs/state.md has the mirror refreshed from the runtime layer every update
  // and fixes no moment for a posed press to reach it, so a build whose pose
  // writes the mirror and one whose next update copies it in are both read.
  const heldAtPose = (await h.snapshot()).pointer.down;
  await h.advance(1);
  assertTrue(
    heldAtPose === true || (await h.snapshot()).pointer.down === true,
    "the press is held, at the pose or on the frame that follows it",
  );

  assertEqual(
    (await h.snapshot()).menuIndex,
    1,
    "the press alone moves the highlight to menu-1 " +
      "(specs/controls.md, Operating a screen with the pointer)",
  );
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "and takes nothing until the release",
  );
  await captureStill(h, "menu");
});
