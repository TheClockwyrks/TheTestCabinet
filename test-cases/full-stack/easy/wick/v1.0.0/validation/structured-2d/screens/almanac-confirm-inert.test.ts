// Wick — screens/almanac-confirm-inert: `confirm` does nothing on the almanac.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`almanac`":
// "`confirm` and `pause` do nothing here." `specs/controls.md` gives the
// `almanac` row no `confirm` at all and binds `confirm` to `Enter`.
//
// WHAT IS READ. The screen, `menuIndex`, `almanacTab`, and `almanacScroll`
// before the press and after it. All three indices are arranged AWAY from `0`
// first, so a build that took the entry as an item to accept — leaving the
// screen, resetting the list, or moving the highlight — is caught whichever of
// those it did, and a build that reset the three to their entry values fails
// on the same reading.
//
// THE DRIVE. `reset`, the almanac posed through the debug surface, two
// `ArrowRight` presses onto the `ENEMIES` tab, twelve `ArrowDown` presses down
// its thirteen entries, which the scroll rule carries off row `0`, then one
// real `Enter`.
//
// THE TOLERANCE. None: a screen name and three indices.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  poseScreen,
  tap,
  type Harness,
} from "../harness";
import { moveEntry, moveTab } from "./almanac";

/** The tab the press is made on, and how far down its list the highlight sits. */
const TAB = 2;
const WALKED = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves the screen and the three almanac indices as they were", async () => {
  h.reset();
  poseScreen(h, "almanac");
  await moveTab(h, TAB);
  const before = await moveEntry(h, WALKED);
  assertEqual(before.almanacTab, TAB, "the tab the press is made on");
  assertEqual(before.menuIndex, WALKED, "menuIndex before the press");
  assertGreaterThan(
    before.almanacScroll,
    0,
    "almanacScroll before the press, the list scrolled off its first row",
  );

  const after = await tap(h, "Enter");
  captureStill(h, "inert");

  assertEqual(
    after.screen,
    "almanac",
    "the screen after Enter on the almanac (specs/ui.md, almanac)",
  );
  assertEqual(after.menuIndex, before.menuIndex, "menuIndex after Enter");
  assertEqual(after.almanacTab, before.almanacTab, "almanacTab after Enter");
  assertEqual(
    after.almanacScroll,
    before.almanacScroll,
    "almanacScroll after Enter",
  );
});
