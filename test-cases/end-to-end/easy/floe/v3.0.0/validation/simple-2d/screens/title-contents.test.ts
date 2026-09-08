// Floe — screens/title-contents: the title screen carries the game's name, its
// tagline and both of its menu entries.
//
// `specs/ui.md` fixes the copy exactly: the `title` screen shows "`TITLE_TEXT`
// (`FLOE`), `TAGLINE_TEXT` (`DON'T LOOK BACK`), and a vertical menu of
// `TITLE_ITEMS` (`CROSS`, `HOW TO PLAY`) in that order". Four named strings, all
// four required, and a build that draws three of them has left the fourth off a
// screen every player sees first.
//
// WHAT IS READ IS THE FRAME, NOT THE STATE. `screens.title-opens` already grades
// that the build REPORTS the title; this check grades what it PUT ON THE CANVAS
// there, by reading the text runs of one rendered frame. A build that reports a
// title screen it never draws fails here and keeps that point, and a build that
// draws the four strings on a screen it never reports fails there and keeps this
// one.
//
// THE MATCH IS A SUBSTRING, IN EITHER CASE, PAST THE HUD. A menu entry is commonly
// set with a marker beside it ("> CROSS <"), and casing, font and typography are
// the build's, so each string is looked for inside the frame's copy rather than as
// a whole run, by the shared harness's `drewTextAnywhere`. Only what the build
// drew over the strait counts, which is what `screenText` hands it and why — the
// HUD bar's own readouts are not this screen's copy.
//
// THE ORDER OF THE MENU IS NOT GRADED HERE. `specs/ui.md` fixes it, and
// `screens.cross-starts-run` and `screens.howto-opens` decide it between them:
// each confirms one index and requires the screen that index's entry names.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertTrue } from "../assert";
import { drewTextAnywhere } from "../case-harness/text";
import { TAGLINE_TEXT, TITLE_ITEMS, TITLE_TEXT } from "../constants";
import {
  captureStill,
  createHarness,
  drawFrame,
  type Harness,
} from "../harness";
import { screenRuns, screenText } from "./screens";

/** Every string `specs/ui.md` requires the title screen to carry. */
const REQUIRED_COPY: readonly string[] = [
  TITLE_TEXT,
  TAGLINE_TEXT,
  ...TITLE_ITEMS,
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws FLOE, its tagline and both title menu items", async () => {
  // `reset` restores the title with `menuIndex` 0 (specs/instrumentation.md), so
  // the frame read below is the title screen whether or not the build's own
  // arrival is right — that is `screens.title-opens`, not this point.
  h.debug.reset();

  const calls = await drawFrame(h);
  captureStill(h, "title");

  const runs = screenRuns(h, calls);
  assertGreaterThan(
    runs.length,
    0,
    "the title screen to draw text over the strait at all (specs/ui.md)",
  );
  const text = screenText(h, calls);
  for (const required of REQUIRED_COPY) {
    assertTrue(
      drewTextAnywhere(text, required),
      `the title screen draws ${JSON.stringify(required)} (specs/ui.md) — ` +
        `the strait drew ${JSON.stringify(runs)}`,
    );
  }
});
