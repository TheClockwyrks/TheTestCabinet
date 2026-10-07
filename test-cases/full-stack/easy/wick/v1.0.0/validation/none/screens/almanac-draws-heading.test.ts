// screens/almanac-draws-heading — the almanac draws its heading.
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
// `setScreen("almanac")`, which specs/instrumentation.md defines as setting
// `screen` alone, "with `menuIndex`, `almanacTab`, and `almanacScroll`
// all `0`", so the route touches no menu and a build
// with a broken title menu fails the title points rather than this one. One
// frame is then run and read as the screen is entered, on its first tab.
//
// THE TOLERANCE. The copy is matched ignoring case and whitespace, across the
// runs of text the frame drew joined in reading order (the shared harness's
// `drewTextAnywhere`) — so a build that letter-spaces its heading, draws a tab
// word by word, or wraps the shown tab in marks of its own passes. The bar's order is a strict inequality between four
// drawn anchors, which no tolerance can soften.
//
// The tab bar is `screens/almanac-draws-tabs`'.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ALMANAC_TEXT } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { openAlmanac } from "./almanac";
import { assertShows, shown } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws THE ALMANAC", async () => {
  const opened = await openAlmanac(h);
  assertEqual(opened.screen, "almanac", "the screen the frame is read on");

  const page = await shown(h);
  await captureStill(h, "heading");

  assertShows(page, ALMANAC_TEXT, "the almanac's heading");
});
