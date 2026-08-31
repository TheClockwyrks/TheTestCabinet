// screens/title-menu-entries — the title menu shows both of its entries, the
// first above the second.
//
// THE RULE. `specs/ui.md` gives the title screen the menu `TITLE_ITEMS` — `PLAY`,
// `HOW TO PLAY`, "in that order" — and says "the menu's entries are stacked one
// above the next under the title and tagline". So both entries are drawn, and the
// first is drawn ABOVE the second. Order matters to a player who confirms before
// reading: a build that stacked them the other way starts a game for someone who
// asked for the instructions.
//
// WHAT IS READ, AND IN WHAT UNITS. The frame's own text draws, each placed back
// into the logical `1280 x 720` field through the transform the build drew it
// with and the viewport the engine letterboxed with (`./menu.ts`). "Above" is
// therefore a comparison of two field coordinates, and it holds for a build that
// drew its menu inside a scale, a translate, or neither.
//
// ATTRIBUTING A RUN TO AN ENTRY. `PLAY` is a substring of `HOW TO PLAY`, so a run
// is attributed to the LONGEST entry it contains: the run reading `HOW TO PLAY` is
// the second entry's and only a run reading `PLAY` without it is the first's.
// Containment rather than equality, because `specs/ui.md` leaves the styling to
// the build and a marker, a bullet or padding beside an entry is still that entry.
//
// THE BOUND IS A STRICT ONE AND IT IS NOT A TOLERANCE. Every run of the first
// entry sits above every run of the second, `y` for `y`: two entries "stacked one
// above the next" cannot share a row, and a build that draws each entry twice — an
// outline under a fill — draws both copies on the same row, so nothing conformant
// straddles the divide.
//
// WHAT THIS ITEM DOES NOT DECIDE. Which entry is highlighted, or that any of them
// is — `screens/title-menu-highlight`. Nor where confirming either one leads,
// which is `screens/play-starts-a-game` and `screens/howto-reachable`.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../../src/constants";
import { assertEqual, assertLessThan } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { entryRow, textRuns } from "./menu";

/** The entries `specs/ui.md` fixes for the title menu, in the order it fixes. */
const ENTRIES = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws both title entries with PLAY above HOW TO PLAY", async () => {
  assertEqual(
    TITLE_ITEMS.length,
    ENTRIES,
    "the title entries specs/ui.md fixes, which this item reads in order",
  );

  h.debug.reset();
  h.clearCalls();
  await h.advance(1);
  captureStill(h, "menu");

  assertEqual(
    h.snapshot().screen,
    "title",
    "the screen the entries were read from",
  );

  // Each read is a hard one: an entry the build never drew fails here, naming the
  // copy specs/ui.md fixes, rather than being compared as a missing number.
  const runs = textRuns(h, h.calls);
  const first = entryRow(runs, TITLE_ITEMS, 0);
  const second = entryRow(runs, TITLE_ITEMS, 1);

  assertLessThan(
    first.bottom,
    second.top,
    `the lowest row ${JSON.stringify(first.item)} was drawn on, against the ` +
      `highest row ${JSON.stringify(second.item)} was drawn on: the first ` +
      `entry is stacked above the second (specs/ui.md)`,
  );
});
