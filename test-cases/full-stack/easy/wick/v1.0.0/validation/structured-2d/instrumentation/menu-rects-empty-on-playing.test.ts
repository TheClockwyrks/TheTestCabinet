// Wick — instrumentation/menu-rects-empty-on-playing: `menuRects()` reports an
// empty list on `playing`.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// "Menus", `menuRects()`: "`playing` reports an empty list."
// `specs/controls.md`, "The pointer and touch", closes its list of answering
// screens with "`playing` answers neither", so the run screen is the one screen
// a gesture reaches nothing on.
//
// WHAT IS READ, AND WHY. The length of the reported list on `playing`. A build
// that reported the rectangles of whatever menu it drew last, or that answered
// a gesture over the run itself, is caught by a non-empty reading here. That
// `howto` and `chest` report their one box each is
// `menu-rects-one-box-without-menu`'s.
//
// THE DRIVE. An isolated `playing` run.
//
// THE TOLERANCE. None: a list is empty or it is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  menuRects,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reports no rectangles on playing", async () => {
  h.reset();
  const playing = isolate(h);
  assertEqual(playing.screen, "playing", "screen reached for playing");
  assertLength(menuRects(h), 0, "menuRects() on playing");
  await h.frameDraw();
  captureStill(h, "empty");
});
