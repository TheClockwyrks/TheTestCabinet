// screens/title-draws-menu-items — the title screen draws all three menu items.
//
// THE RULE, from the title screen's own table in `specs/ui.md`, Screens:
//
//   | Element | Constant | Content |
//   | Menu | `TITLE_ITEMS` | `CAMPAIGN`, `EXTRAS`, `HOW TO PLAY`, in that order |
//
// This point decides that every entry is SHOWN. Where they sit relative to one
// another is `title-items-stacked-in-order`'s, which item is highlighted is
// `title-highlight-distinct`'s, and what each one does is the four `confirm`
// points'.
//
// THE CONFIGURATION is the title screen and nothing else: a `reset` puts the game
// back where it opens, and one frame draws it. Nothing is posed beyond that, so a
// build that drew an item only once the highlight reached it is read at the
// arrival state `specs/ui.md` fixes — `menuIndex` `0` — where two of the three
// are unhighlighted.
//
// HOW THE TEXT IS READ. `specs/assets.md` puts every word on the stage on the
// frame as drawn text and fixes no more — "Which typeface carries them is
// yours" — and letter spacing is not portable, so a build is free to draw one
// run of copy as one call, as a call per word, or as a call per glyph. What
// all of those share is the baseline: one line of copy is drawn at one `y`. So
// each entry is read with the shared harness's `drewText` — the frame's logical
// runs gathered onto the baselines they share, matched by substring, ignoring
// case and whitespace — so a build is free to draw a marker or padding around
// an item's words.
//
// THE VERDICT. Every entry of `TITLE_ITEMS` is on some line of the title frame,
// and the failure names the first entry that is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { drewText } from "../case-harness/text";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  openTitle,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws every entry of TITLE_ITEMS on the title screen", async () => {
  await openTitle(h);

  const calls = await h.lastCalls();
  await captureStill(h, "menu");

  const shown = await h.snapshot();
  assertEqual(
    shown.screen,
    "title",
    "the frame this point reads is the title screen's",
  );
  for (const item of TITLE_ITEMS) {
    assertTrue(
      drewText(calls, item),
      `the title frame draws the TITLE_ITEMS entry ${item}`,
    );
  }
});
