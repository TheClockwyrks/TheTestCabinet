// screens/mode-descriptions-before-choosing — moving the highlight across the five
// modes draws a different body of text for each, and starts nothing.
//
// THE RULE. specs/screens.md's `modeselect` section: "Each mode's description is
// readable before it is chosen: moving the highlight across the five rows draws a
// different body of text for each, describing what that mode is and what it
// changes, and moving the highlight starts nothing."
//
// WHAT IS READ, AND WHY THE ROW LABELS ARE TAKEN OUT FIRST. The five rows are
// drawn on every one of the five frames, so a frame's text as a whole differs
// between two rows for a reason that has nothing to do with a description — a
// marker beside the highlighted row is enough. So every run of text that IS one of
// `MODE_ITEMS`, once the decoration around it is stripped, is dropped, and what is
// left is the body the screen drew beside the list. A description that happens to
// mention its own mode survives that filter, because it is a sentence rather than
// the bare label.
//
// THE BAR IS A BODY OF TEXT, NOT A MARK. For each row, what must be there is text
// that appears on that row's frame and on none of the other four. A build that
// swaps a marker glyph or reverses one row's colour draws no text of its own there
// and reads zero, because a run is compared on its letters, digits and inner
// spaces alone and a marker leaves none of those behind. A build that draws no
// body at all reads zero, and so does one that draws all five descriptions at
// once, unchanged as the highlight moves — which is what the specification's
// "moving the highlight ... draws a different body of text for each" asks, since
// the description a player is reading has to be the one belonging to the row they
// are on.
//
// HOW LONG THE BODY RUNS IS NEVER READ. specs/screens.md fixes not one word of a
// description, so what is decided here is that the row drew one and the reviewer
// reads it off the still.
//
// AND IT STARTS NOTHING. The screen is read after every move: five presses across
// the list must leave the game exactly where it was, on `modeselect`, with no run
// begun. A build that starts a mode on the MOVE rather than on the confirm is the
// failure this half catches, and it is the one that would take a player's choice
// away from them.
//
// THE HIGHLIGHT IS POSED ON EACH ROW RATHER THAN WALKED ALONG THE LIST. Whether
// `down` moves it is `controls.menu-down`'s requirement; posing each row in turn
// is the same five frames without a second item's behaviour underneath them.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { MODE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  drawFrame,
  drawnTextLines,
  type Harness,
} from "../harness";
import { isRowLabel, normalize, poseMenu } from "./menu";

/**
 * How many characters of text must belong to a row and to no other row: one.
 *
 * specs/screens.md asks for "a body of text ... describing what that mode is and
 * what it changes" and fixes not one word of it, so what is read is whether the
 * row drew a body of its own AT ALL, which is the smallest count there is. The
 * reading is in characters rather than in runs of text, because how a build breaks
 * its copy into lines is its own business.
 */
const MIN_DISTINCT_CHARS = 1;

/**
 * The rows a description is read on: the five that name a mode, in `MODE_ITEMS`
 * order.
 *
 * `BACK` is the sixth row and is excluded, because specs/screens.md says of it
 * that it "names no mode and draws no description".
 */
const ROWS = MODE_ITEMS.flatMap((item, index) =>
  item === "BACK" ? [] : [index],
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a different description for each mode, and starts nothing", async () => {
  poseMenu(h, "modeselect", ROWS[0]);

  // The body of text each row drew, with the five row labels themselves taken out.
  const bodies: string[][] = [];
  for (const row of ROWS) {
    h.debug.setMenuIndex(row);
    const calls = await drawFrame(h);
    if (row === ROWS[0]) captureStill(h, "description");

    const after = h.snapshot();
    assertEqual(
      after.screen,
      "modeselect",
      `moving the highlight to row ${row} started nothing: the screen is ` +
        `still the list (specs/screens.md)`,
    );
    assertEqual(
      after.surge.length,
      0,
      `moving the highlight to row ${row} released no surge ` +
        `(specs/screens.md)`,
    );

    // The logical runs the row spells, not the `fillText` split: a build that
    // letter-spaces its copy draws it a glyph per call, and a glyph is neither a
    // row label to strike out nor text distinct to the row that drew it.
    bodies.push(
      drawnTextLines(calls)
        .filter((text) => !isRowLabel(text, MODE_ITEMS))
        .map(normalize)
        .filter((text) => text.length > 0),
    );
  }

  for (const row of ROWS) {
    const others = new Set(
      ROWS.filter((other) => other !== row).flatMap((other) => bodies[other]),
    );
    const distinct = bodies[row].filter((text) => !others.has(text));
    const characters = distinct.reduce((sum, text) => sum + text.length, 0);
    assertGreaterThanOrEqual(
      characters,
      MIN_DISTINCT_CHARS,
      `the characters of text the ${JSON.stringify(MODE_ITEMS[row])} row ` +
        `drew that no other row drew — a description of that mode, readable ` +
        `before it is chosen (specs/screens.md); what was distinct to it was ` +
        `${JSON.stringify(distinct)}`,
    );
  }
});
