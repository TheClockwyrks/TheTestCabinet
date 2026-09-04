// screens/almanac-copy — the almanac draws its heading and its four tabs.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`almanac`"): "It shows
// `ALMANAC_TEXT` (`THE ALMANAC`), the tab bar `ALMANAC_TABS` (`TOOLS`,
// `TRINKETS`, `ENEMIES`, `PICKUPS`, in that order) across the top". So the five
// pieces of copy are fixed, and so is the ONE arrangement this reads: a bar
// drawn across the stage in `ALMANAC_TABS` order runs left to right in that
// order. specs/ui.md ("Presentation") fixes "no palette, no font, and no
// styling for any screen, and each screen's layout is yours except where a
// table below places one element relative to another", so nothing else about
// where the heading or the bar sits is read.
//
// WHY THE WORLD IS POSED AS IT IS. The almanac is entered through
// `setScreen("almanac")`, which specs/instrumentation.md makes the same
// arrival as confirming `THE ALMANAC`, so the route touches no menu and a build
// with a broken title menu fails the title points rather than this one. One
// frame is then run and read as the screen is entered, on its first tab.
//
// THE TOLERANCE. The copy is matched folded — lower-cased, with spaces, dashes
// and underscores removed, across consecutive runs of text — so a build that
// letter-spaces its heading, draws a tab word by word, or wraps the shown tab in
// marks of its own passes. The bar's order is a strict inequality between four
// drawn anchors, which no tolerance can soften.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { ALMANAC_TABS, ALMANAC_TEXT } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { openAlmanac, mustColumnX } from "./almanac";
import { assertShows, shown } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws THE ALMANAC and the four tab names across the stage in order", async () => {
  const opened = await openAlmanac(h);
  assertEqual(opened.screen, "almanac", "the screen the frame is read on");

  const page = await shown(h);
  await captureStill(h, "almanac");

  assertShows(page, ALMANAC_TEXT, "the almanac's heading");
  for (const tab of ALMANAC_TABS) {
    assertShows(page, tab, "the almanac's tab bar");
  }

  const columns = ALMANAC_TABS.map((tab) =>
    mustColumnX(page, tab, "the almanac's tab bar"),
  );
  for (let i = 1; i < columns.length; i += 1) {
    assertGreaterThan(
      columns[i]!,
      columns[i - 1]!,
      `the column of the tab ${ALMANAC_TABS[i]}, drawn across the top after ` +
        `${ALMANAC_TABS[i - 1]} (specs/ui.md)`,
    );
  }
});
