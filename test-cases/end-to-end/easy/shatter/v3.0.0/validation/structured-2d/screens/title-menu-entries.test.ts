// screens/title-menu-entries — the title menu shows both of its entries, the
// first above the second.
//
// `specs/ui.md` fixes the title menu as `TITLE_ITEMS` — `PLAY`, `HOW TO PLAY`,
// "in that order" — and states how the order is shown: "The menu's entries are
// stacked one above the next under the title and tagline." So the point is two
// readings of one frame: both entries were drawn, and the first was drawn ABOVE
// the second.
//
// THE ORDER IS A PLACEMENT, NOT A DRAW ORDER. Which entry a build's render
// happens to issue first says nothing about what a player sees, so the reading
// is where each entry's glyphs LANDED — `harness.ts`'s `spelledTextRuns` maps
// each run's anchor back through the transform the context held at the call, so
// a build that draws its menu through a transform of its own is read in the same
// logical units as one that does not, and coalesces a run drawn a glyph at a
// time back into the entry it spells.
//
// ABOVE IS STRICTLY ABOVE, AND NO FIGURE IS FIXED FOR IT. `specs/ui.md` states
// the stacking and leaves "the layout of each screen" to the build, so the check
// asserts the sign of the separation and nothing about its size: a menu with
// forty units between its entries and one with a hundred are both stacked. There
// is no tolerance to state because there is no threshold — a menu whose entries
// are the wrong way up reads as a separation of the opposite sign, and one that
// draws both on a single line reads as zero.
//
// THE ENTRIES ARE TOLD APART BY THE LONGEST ENTRY EACH RUN SHOWS, because
// `HOW TO PLAY` contains `PLAY`; `reading.ts` states why.
//
// THE SCREEN IS POSED BY `reset`, which `specs/instrumentation.md` says restores
// `screen` to `"title"` and `menuIndex` to `0` — the direct route to the screen
// this point is about, with the highlight where the specification says it rests
// on arriving.
//
// WHAT THIS DOES NOT DECIDE. Which entry is highlighted and that the highlight
// moves (`screens/title-menu-highlight`), where either entry leads
// (`screens/play-starts-a-game`, `screens/howto-reachable`), and the title copy
// above the menu (`screens/title-shows-the-title`).

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import { assertLessThan, fail } from "../assert";
import { drawnTextLines, drewText } from "../case-harness/text";
import {
  captureStill,
  clearCalls,
  createHarness,
  resetTo,
  type Harness,
} from "../harness";
import { menuRows } from "./reading";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws both TITLE_ITEMS, the first stacked above the second", async () => {
  // The title screen `reset` restores, drawn once.
  resetTo(h);
  clearCalls(h);
  await h.advance(1);
  captureStill(h, "menu");

  for (const item of TITLE_ITEMS) {
    if (!drewText(h.calls, item)) {
      fail(
        `the title menu entry ${JSON.stringify(item)} drawn on the title ` +
          "screen's frame — TITLE_ITEMS is PLAY, HOW TO PLAY (specs/ui.md)",
        drawnTextLines(h.calls),
      );
    }
  }

  const [first, second] = menuRows(h, TITLE_ITEMS);
  assertLessThan(
    first.y - second.y,
    0,
    `how far ${JSON.stringify(first.item)} was drawn BELOW ` +
      `${JSON.stringify(second.item)}, in logical units — the entries are ` +
      "stacked one above the next in the order TITLE_ITEMS gives them " +
      `(specs/ui.md), so the first is drawn at a smaller y than the second; ` +
      `${JSON.stringify(first.item)} landed at y ${String(first.y)} and ` +
      `${JSON.stringify(second.item)} at y ${String(second.y)}`,
  );
});
