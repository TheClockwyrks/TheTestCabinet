// screens/title-draws-its-copy — the title screen draws its title, its tagline
// and both menu entries.
//
// THE REQUIREMENT. `specs/ui.md` fixes the title's copy exactly: `TITLE_TEXT`
// (`ARC FOUNDRY`), `TAGLINE_TEXT` (`GROUND THE LOAD`) and `TITLE_ITEMS`
// (`SALVAGE`, `HOW TO PLAY`, in that order). `specs/instrumentation.md` has
// `reset` return the game to the title with the menu index at `0`.
//
// HOW IT IS DECIDED. Two readings of the same frame. The state: after `reset` the
// screen reads `title` with `menuIndex` `0`. The copy: the frame's own text draws
// carry the title, the tagline and both menu entries. Matching is by substring
// and ignores case, because `specs/ui.md` leaves the layout, the palette and the
// type to the build and a menu entry is commonly drawn with a marker beside it.
//
// Which entry is drawn as the current one is a second requirement, and
// `screens/title-marks-the-selection` decides that.
//
// THE WORDMARK AND THE TAGLINE, ACROSS LINE BREAKS. `specs/ui.md` fixes the WORDS
// of those two elements and nothing about how they are set, so a wordmark stacked
// over two baselines (`ARC` above `FOUNDRY`) or a tagline wrapped onto a second
// line has drawn the copy the specification names. Their reading is therefore the
// package's `drewTextAnywhere`, over every run of the frame joined in reading
// order, which is the reading its own header keeps for copy a build may break
// across lines.
//
// A MENU ENTRY IS READ AS AN ENTRY, NOT AS A WORD ON THE SCREEN. `drewTextAnywhere`
// answers whether the copy is anywhere in the frame, and for `SALVAGE` that is a
// question a title screen can answer without drawing a menu at all: a strap line
// or a caption carrying the word satisfies it, and so does a substring reading of
// any single baseline. `specs/ui.md` calls `TITLE_ITEMS` the screen's MENU and
// fixes the two items and their order, so what is asked of each is that the frame
// carry it AS ONE PIECE OF COPY — a run, or a whole baseline, that reads as the
// entry once any marker is taken off either end, since a build is free to set a
// marker beside the current entry. A tracked entry that comes back as one run per
// word is caught by the baseline reading, an entry sharing its baseline with a
// hint is caught by the run reading, and `AF / ELECTRICAL SALVAGE DIVISION` is
// neither of those things and answers neither.
//
// WHAT THIS POINT DOES NOT DECIDE: which entry is marked, which is
// `screens/title-marks-the-selection`, and nothing here reads a highlight.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TAGLINE_TEXT, TITLE_ITEMS, TITLE_TEXT } from "../constants";
import type { DrawCall } from "../case-harness/draw-calls";
import {
  drawnTextLines,
  drawnTextRuns,
  drewTextAnywhere,
} from "../case-harness/text";
import { captureStill, createHarness, type Harness } from "../harness";

/**
 * A menu entry's copy, compared the way the header describes.
 *
 * Case and whitespace fold out of both sides, as they do in the package's own
 * copy comparisons, and anything that is not a letter or a digit comes off
 * either END of what the frame drew — the marker `specs/ui.md` leaves a build
 * free to set beside the current entry, a bracket, an arrow, a rule. Nothing
 * comes out of the middle, so `HOW TO PLAY` is still `HOW TO PLAY` and
 * `SALVAGE -> REFINE -> COMBINE` is not `SALVAGE`.
 */
function readsAsEntry(drawn: string, entry: string): boolean {
  const fold = (text: string): string => text.replace(/\s+/g, "").toLowerCase();
  const marker = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
  return fold(drawn).replace(marker, "") === fold(entry);
}

/** Whether the frame carries `entry` as one piece of copy: a run, or a line. */
function drewEntry(calls: readonly DrawCall[], entry: string): boolean {
  return (
    drawnTextRuns(calls).some((run) => readsAsEntry(run.text, entry)) ||
    drawnTextLines(calls).some((line) => readsAsEntry(line, entry))
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws its title, its tagline and both menu entries", async () => {
  await h.debug.reset();
  const calls = await h.frameCalls();
  await captureStill(h, "title");

  const opened = await h.snapshot();
  assertEqual(
    opened.screen,
    "title",
    "the screen a reset returns the game to (specs/ui.md)",
  );
  assertEqual(
    opened.menuIndex,
    0,
    "the highlighted entry on arriving at the title (specs/ui.md)",
  );

  assertEqual(
    drewTextAnywhere(calls, TITLE_TEXT),
    true,
    `the title screen to draw TITLE_TEXT, ${TITLE_TEXT} (specs/ui.md)`,
  );
  assertEqual(
    drewTextAnywhere(calls, TAGLINE_TEXT),
    true,
    `the title screen to draw TAGLINE_TEXT, ${TAGLINE_TEXT} (specs/ui.md)`,
  );
  for (const item of TITLE_ITEMS) {
    assertEqual(
      drewEntry(calls, item),
      true,
      `the title screen to draw its ${item} entry as an entry — a run or a ` +
        `baseline that reads as ${item} once any marker is taken off either ` +
        `end, rather than the word somewhere in a longer line (specs/ui.md)`,
    );
  }
});
