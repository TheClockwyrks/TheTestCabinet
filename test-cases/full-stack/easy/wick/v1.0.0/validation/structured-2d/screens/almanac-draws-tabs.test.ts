// Wick — screens/almanac-draws-tabs: the almanac draws its four tab names,
// running across the top in `ALMANAC_TABS` order.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`almanac`": "It
// shows `ALMANAC_TEXT` (`THE ALMANAC`), the tab bar `ALMANAC_TABS` (`TOOLS`,
// `TRINKETS`, `ENEMIES`, `PICKUPS`, in that order) across the top".
//
// WHAT IS READ. The strings the frame drew, and where across the stage it drew
// the four tab names. The palette, the font, and the styling are the build's
// ("Wick fixes no palette, no font, and no styling for any screen"), so the
// reading is which copy appeared and, for the tabs alone, which of them sits
// further left. A run of text is matched as a SUBSTRING, so a build that marks
// the tab at `almanacTab` or pads its labels still reads as having drawn them.
//
// THE DRIVE. `reset`, the almanac posed through the debug surface, which enters
// it by setting `screen` with the three menu indices at `0` and the run left as
// it stands (`specs/instrumentation.md`), and one frame. Nothing is pressed:
// the copy is what the screen draws before anything is touched.
//
// THE TOLERANCE. The strings are exact, ignoring case and surrounding
// characters. The tab order is strict: each name's leftmost anchor is to the
// LEFT of the next name's, with no slack, since two tabs drawn at one place on
// a bar that runs across the top are not in an order at all.
//
// The heading is `screens/almanac-draws-heading`'.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThan, assertNotNull, assertTrue } from "../assert";
import { ALMANAC_TABS } from "../constants";
import {
  captureStill,
  createHarness,
  drewText,
  poseScreen,
  placedRuns,
  type Harness,
} from "../harness";
import { anchorX } from "./almanac";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws the four tab names left to right", async () => {
  h.reset();
  poseScreen(h, "almanac");

  const { calls } = await h.frameDraw();
  captureStill(h, "tabs");

  for (const copy of ALMANAC_TABS) {
    assertTrue(
      drewText(calls, copy),
      `the almanac frame drew ${JSON.stringify(copy)} (specs/ui.md, almanac)`,
    );
  }

  const draws = placedRuns(calls);
  for (let tab = 1; tab < ALMANAC_TABS.length; tab += 1) {
    const before = anchorX(draws, ALMANAC_TABS[tab - 1]);
    const here = anchorX(draws, ALMANAC_TABS[tab]);
    assertNotNull(before, `where ${ALMANAC_TABS[tab - 1]} was drawn`);
    assertNotNull(here, `where ${ALMANAC_TABS[tab]} was drawn`);
    assertLessThan(
      before as number,
      here as number,
      `${ALMANAC_TABS[tab - 1]} drawn left of ${ALMANAC_TABS[tab]} on the tab bar, in device pixels across the stage`,
    );
  }
});
