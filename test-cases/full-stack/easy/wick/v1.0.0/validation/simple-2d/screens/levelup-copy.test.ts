// screens/levelup-copy — the level-up overlay draws its heading.
//
// WHAT THIS DECIDES. One thing: the level-up frame carries `LEVEL_UP_TEXT` over
// the world the tick that opened it left behind. What the offers under the
// heading show is each its own point.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`levelup`): "An overlay over the world, which stays drawn
//   beneath it exactly as the tick that opened the overlay left it. It shows
//   `LEVEL_UP_TEXT` (`THE LAMP BURNS BRIGHTER`) and the offers in `offers`".
//   specs/progression.md ("The level-up overlay"): "A `playing` tick that ends
//   with `pendingLevelUps` above `0` runs to completion and then opens the
//   overlay: `screen` becomes `levelup` with `menuIndex` `0`."
//
// THE DRIVE. An isolated `playing` run, one level-up queued through
// `setPendingLevelUps`, and the tick that opens the overlay, which is the real
// path a gain takes; no menu is walked and no offer is chosen. One frame is
// then drawn and its runs of text are read.
//
// THE TOLERANCE. The heading is matched as a substring of the frame's text
// through the shared harness's `drewTextAnywhere`, ignoring case and whitespace
// across every run the frame drew, so a build that wraps it over two lines or
// draws a shadow under it passes, while one showing other words fails. Nothing about the heading's
// colour, font, size, or place is read: specs/ui.md "fixes no palette, no font,
// no layout, and no styling for any screen".

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { LEVEL_UP_TEXT } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";
import { drewTextAnywhere } from "../case-harness/text";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws THE LAMP BURNS BRIGHTER over the held world", async () => {
  isolate(h);
  const opened = await openLevelUp(h, 1);
  assertEqual(
    opened.screen,
    "levelup",
    "the screen the queued level-up opened",
  );

  const { calls } = await h.frameDraw();
  captureStill(h, "overlay");

  assertEqual(
    drewTextAnywhere(calls, LEVEL_UP_TEXT),
    true,
    `the overlay's frame draws ${LEVEL_UP_TEXT}`,
  );
});
