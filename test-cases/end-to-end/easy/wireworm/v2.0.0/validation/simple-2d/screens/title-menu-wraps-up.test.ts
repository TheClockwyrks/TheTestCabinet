// Wireworm — screens/title-menu-wraps-up: `up` on the title's first item wraps
// the highlight to the last.
//
// The other end of the rule `specs/controls.md` fixes: "`up` and `down` move the
// highlight by one item and wrap at both ends, so ... moving up from the first
// highlights the last". Its own check, so a build that wraps downward and not
// upward grades apart from one that wraps neither way.
//
// The first item is POSED with the surface's own `setMenuIndex` rather than left
// to whatever `reset` happened to leave, so the edge the press is made from is
// stated by this check rather than inherited.
//
// The press is the `up` action's own bound key, dispatched as a real key event
// at the target the engine listens on — the menus are keyboard only
// (`specs/controls.md`).

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

/** `up`'s own bound key (specs/controls.md). */
const UP_KEY = "ArrowUp";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("wraps the title highlight from the first item to the last", async () => {
  h.debug.reset();
  h.debug.setMenuIndex(0);
  const posed = h.snapshot();
  assertEqual(posed.screen, "title", "the press is made on the title screen");
  assertEqual(
    posed.menuIndex,
    0,
    "setMenuIndex rests the highlight on the first title item " +
      "(specs/instrumentation.md)",
  );

  await h.tap(UP_KEY);
  captureStill(h, "wrapped");

  const wrapped = h.snapshot();
  assertEqual(wrapped.screen, "title", "the wrap leaves the game on the title");
  assertEqual(
    wrapped.menuIndex,
    TITLE_ITEMS.length - 1,
    "one up press past the first item highlights the last " +
      "(specs/controls.md)",
  );
});
