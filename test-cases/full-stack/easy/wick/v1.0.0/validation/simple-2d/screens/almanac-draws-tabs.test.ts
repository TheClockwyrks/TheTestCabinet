// screens/almanac-draws-tabs — the almanac draws its tab bar.
//
// WHAT THIS DECIDES. One thing: the almanac's frame carries `ALMANAC_TEXT` and
// the name of every tab in `ALMANAC_TABS`. What each tab LISTS, and which tab
// is drawn distinctly, are their own points.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`almanac`): "It shows `ALMANAC_TEXT` (`THE ALMANAC`), the tab
//   bar `ALMANAC_TABS` (`TOOLS`, `TRINKETS`, `ENEMIES`, `PICKUPS`, in that
//   order) across the top".
//   specs/ui.md ("Presentation"): "Wick fixes no palette, no font, and no
//   styling for any screen, and each screen's layout is yours except where a
//   table below places one element relative to another."
//
// THE DRIVE. The almanac through `setScreen("almanac")`, which enters it
// "exactly as confirming `THE ALMANAC` does" (specs/instrumentation.md), so a
// build with a broken title menu fails its own point and not this one, then one
// frame. No key is pressed, so the tab the screen opens on is the one drawn.
//
// THE TOLERANCE. The copy is compared as words in order through `drewPhrase`,
// so a build that wraps a heading, draws a shadow under it, or marks the tab at
// `almanacTab` passes while a build showing other words fails. Where across the
// top the bar runs, and in which direction, is not read: `ALMANAC_TABS` names
// the order the constant holds its tabs in, and specs/ui.md places no tab
// relative to another.
//
// The heading is `screens/almanac-draws-heading`'.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { ALMANAC_TABS } from "../constants";
import {
  captureStill,
  createHarness,
  drewPhrase,
  poseScene,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws all four tab names", async () => {
  const posed = poseScene(h, "almanac");
  assertEqual(posed.screen, "almanac", "the screen the frame is read from");

  const { calls } = await h.frameDraw();
  captureStill(h, "tabs");

  assertDeepEqual(
    ALMANAC_TABS.filter((text) => !drewPhrase(calls, text)),
    [],
    "the tab names specs/ui.md gives the almanac, missing from its frame",
  );
});
