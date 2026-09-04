// Wick — pointer/title-hover-plays-menu-move: the frame a hover moves the
// highlight plays `menu-move`, once.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/controls.md`, The pointer,
// rule 1, Hover: "The pointer inside the rectangle of the item at `menuIndex`
// `i`, with `menuIndex` not `i`, sets `menuIndex` to `i` and plays
// `menu-move`." `specs/ui.md`, Menu navigation: "Every move of a highlight
// plays `menu-move`, whichever of the two moved it". `specs/ui.md`, Audio,
// binds `menu-move` to "A menu highlight moves" and plays each cue "on the tick
// its event happens, or on the frame for a menu event, and at most once on that
// tick". One move on one frame is therefore exactly one `menu-move`.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. Every cue the build played while
// the hovering frame ran, off the engine's own bus, counted by name. The move
// itself is read from `menuIndex` first, so a build that moved no highlight
// fails on the move rather than on the count, and a build that moved it in
// silence fails on the count.
//
// THE DRIVE. `reset` to the title screen with `menuIndex` `0`, the second
// item's rectangle read off `menuRects`, and the pointer moved to its middle
// for one frame — the frame the pointer ENTERS the rectangle on, which is the
// frame the cue belongs to. A pose "sounds nothing"
// (`specs/instrumentation.md`), so every cue the collector holds was raised by
// that frame.
//
// THE TOLERANCE. None: the specification fixes the cue to the frame of the move
// and to at most one play on it, and the collector reads whole frames.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { CUES, TITLE_ITEMS } from "../constants";
import {
  captureReplay,
  createHarness,
  hoverRect,
  menuRects,
  type Harness,
} from "../harness";
import { cuesDuring, heard } from "./pointing";

/** The index of THE ALMANAC, the second item of TITLE_ITEMS (specs/ui.md). */
const SECOND_ITEM = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays menu-move once on the frame the pointer enters the second item", async () => {
  h.reset();
  const before = h.snapshot();
  assertEqual(before.screen, "title", "the screen the pointer rests on");
  assertEqual(before.menuIndex, 0, "menuIndex before the pointer moved");

  const rects = menuRects(h);
  assertLength(
    rects,
    TITLE_ITEMS.length,
    "the title menu's rectangles, one per item (specs/controls.md, The pointer)",
  );

  await captureReplay(h, "move", async () => {
    const { result, played } = await cuesDuring(h, () =>
      hoverRect(h, rects[SECOND_ITEM]),
    );
    assertEqual(
      result.menuIndex,
      SECOND_ITEM,
      "menuIndex after the hover (specs/controls.md, Hover)",
    );
    assertEqual(
      heard(played, CUES.menuMove),
      1,
      "menu-move cues on the frame the hover moved the highlight (specs/ui.md, Menu navigation)",
    );
  });
});
