// screens/title-confirm-the-almanac — `confirm` on `THE ALMANAC` opens the
// almanac.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`title`"): "`confirm` takes the
// highlighted item", and the item row "`THE ALMANAC` | Sets `screen = almanac`,
// with `menuIndex`, `almanacTab`, and `almanacScroll` all `0`."
// specs/ui.md ("`almanac`") says the same from the screen's side: "`menuIndex`,
// `almanacTab`, and `almanacScroll` are `0` on arriving."
//
// WHY THE WORLD IS POSED AS IT IS. The surface carries no pose for `menuIndex`,
// so `THE ALMANAC` is highlighted the only way it can be: one `ArrowDown` from
// the `0` the title is entered on, since it is the second of `TITLE_ITEMS`, with
// the index read back before the confirm so that a build whose `down` is broken
// fails on the precondition rather than confirming the wrong item. Both presses
// are REAL keys through Chromium's input pipeline, each held across exactly one
// frame.
//
// THE TOLERANCE. None: a screen name and three indices are exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  pressConfirm,
  pressDown,
  type Harness,
} from "../harness";
import { assertHighlight } from "./stage";

/** The index of `THE ALMANAC` in `TITLE_ITEMS`. */
const THE_ALMANAC = TITLE_ITEMS.indexOf("THE ALMANAC");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("enters almanac with menuIndex, almanacTab and almanacScroll 0 when Enter takes THE ALMANAC", async () => {
  const title = await h.snapshot();
  assertEqual(title.screen, "title", "the screen the press is made on");
  let posed = title;
  for (let i = 0; i < THE_ALMANAC; i += 1) posed = await pressDown(h);
  assertEqual(
    posed.menuIndex,
    THE_ALMANAC,
    "the highlighted item, THE ALMANAC",
  );

  const after = await pressConfirm(h);
  await captureStill(h, "almanac");

  assertHighlight(after, "almanac", 0, "after Enter took THE ALMANAC");
  assertEqual(
    after.almanacTab,
    0,
    "almanacTab after Enter took THE ALMANAC (specs/ui.md)",
  );
  assertEqual(
    after.almanacScroll,
    0,
    "almanacScroll after Enter took THE ALMANAC (specs/ui.md)",
  );
});
