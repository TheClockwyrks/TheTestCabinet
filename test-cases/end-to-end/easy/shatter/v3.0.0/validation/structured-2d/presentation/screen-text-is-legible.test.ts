// presentation/screen-text-is-legible — every screen draws text of its own.
//
// THE RULE. `specs/ui.md`: "Every piece of text a screen shows is legible against
// whatever sits behind it at the logical field size, `1280 x 720`. The palette, the
// type, and the layout of each screen are yours." `specs/overview.md` states it once
// more as something a player reads at a glance: "Every readout and every screen's
// text is legible against its background at the logical field size."
//
// WHAT IS DECIDED HERE, AND WHAT IS NOT. Legibility is a contrast between a mark and
// the ground under it, and the palette and the type are the build's by that same
// sentence, so how well a build's text reads is the picture the reviewer judges. What
// a script decides is the half beneath it: each of the five screens submits text for
// a player to read.
//
// A DRAW CALL RATHER THAN A PIXEL. The reading is the runs of text the BUILD's own
// frame submitted (`textRuns`, `ink.ts`), which says what the build did rather than
// what one frame happened to look like. Runs of nothing but whitespace are dropped,
// because a build that submits an empty string has drawn a player no text.
//
// THE FIVE SCREENS. `specs/ui.md` fixes exactly five, each with text of its own, so
// each is posed with `setScreen` and read on its own frame. Every screen is posed
// over the same emptied, gated field. The highlight is put on the first entry, which
// is where `specs/ui.md` rests it on arriving at a menu, so the check reads a menu in
// the state the specification describes.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  clearCalls,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import type { Screen } from "../surface";
import { textRuns, type TextRun } from "./ink";

/** The five screens `specs/ui.md` fixes, in the order it tabulates them. */
const SCREENS: readonly Screen[] = [
  "title",
  "howto",
  "playing",
  "paused",
  "gameover",
];

/** The runs of text a frame drew that show a player something. */
function shownRuns(harness: Harness): TextRun[] {
  return textRuns(harness).filter((run) => run.text.trim() !== "");
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws text on every one of the five screens", async () => {
  for (const screen of SCREENS) {
    startPlaying(h);
    h.debug.setScreen(screen);
    h.debug.setMenuIndex(0);
    clearCalls(h);
    await h.advance(1);
    captureStill(h, "screens");

    const runs = shownRuns(h);

    assertGreaterThan(
      runs.length,
      0,
      `the ${screen} screen: how many runs of text it drew, where every ` +
        "screen shows text of its own (specs/ui.md)",
    );
  }
});
