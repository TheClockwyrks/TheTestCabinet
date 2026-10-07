// screens/almanac-lists-pickups — the PICKUPS tab lists every gem and pickup.
//
// WHAT THIS DECIDES. One thing: the pickups tab's list holds the three gem
// names then the three pickup names, drawn one below the next in that order.
// What the highlighted entry SHOWS is `almanac-shows-pickup-detail`'s point.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`almanac`, the entries table): "`PICKUPS` | the three of
//   `GEM_TIERS`, then the three of `PICKUP_KINDS`".
//   specs/ui.md (`almanac`, the names table): `GEM_NAMES` `Small Gem`,
//   `Medium Gem`, `Large Gem`, and `PICKUP_NAMES` `Chest`, `Bread`, `Draft`.
//   specs/ui.md (`almanac`): "the entries of that tab listed down the left",
//   "a tab of `ALMANAC_ROWS` entries or fewer shows all of them", and "Each row
//   shows its entry's name."
//
// THE DRIVE. The almanac through `setScreen("almanac")`, then three
// `ArrowRight` presses to reach the pickups tab through the screen's own key,
// and one frame. The tab holds six entries, fewer than `ALMANAC_ROWS`, so one
// frame shows all of them and no walk of the list is needed.
//
// THE TOLERANCE. Each name is matched as a run of text holding it, so a build
// that marks the highlighted row or draws a shadow under its text passes; the
// order is read as a strict inequality between the topmost anchor of each
// name, which admits any pitch, font, alignment and place the build chose.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ALMANAC_ENTRY_NAMES } from "../constants";
import {
  captureStill,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";
import { assertNamesDown, tabIndex, walkToTab } from "./almanac";

let h: Harness;

/** The six names, in the order specs/ui.md's entries table gives them. */
const NAMES = ALMANAC_ENTRY_NAMES.PICKUPS;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lists the three gems and the three pickups down the frame, in order", async () => {
  const posed = poseScene(h, "almanac");
  assertEqual(posed.screen, "almanac", "the screen the frame is read from");

  const staged = await walkToTab(h, "PICKUPS");
  assertEqual(
    staged.almanacTab,
    tabIndex("PICKUPS"),
    "the tab the list is read on",
  );
  assertEqual(staged.almanacScroll, 0, "the list's first row on the new tab");

  const { calls } = await h.frameDraw();
  captureStill(h, "pickups");

  assertNamesDown(calls, NAMES, "the pickups tab's list");
});
