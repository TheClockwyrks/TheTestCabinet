// Wick — screens/almanac-draws-heading: the almanac draws its heading.
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
// The tab bar is `screens/almanac-draws-tabs`'.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import { ALMANAC_TEXT } from "../constants";
import {
  captureStill,
  createHarness,
  drewText,
  poseScreen,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws THE ALMANAC", async () => {
  h.reset();
  poseScreen(h, "almanac");

  const { calls } = await h.frameDraw();
  captureStill(h, "heading");

  assertTrue(
    drewText(calls, ALMANAC_TEXT),
    `the almanac frame drew ${JSON.stringify(ALMANAC_TEXT)} (specs/ui.md, almanac)`,
  );
});
