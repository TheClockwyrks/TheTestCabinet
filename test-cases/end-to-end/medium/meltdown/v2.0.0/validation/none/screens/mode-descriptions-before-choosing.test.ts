// Meltdown — screens/mode-descriptions-before-choosing: each mode explains itself
// before it is chosen.
//
// THE RULE. `specs/screens.md`, on `modeselect`: "Each mode's description is
// readable before it is chosen: moving the highlight across the five rows draws a
// different body of text for each, describing what that mode is and what it
// changes, and moving the highlight starts nothing."
//
// WHAT IS DECIDED, AND WHAT IS THE REVIEWER'S. Whether the prose really describes
// The Hundred is a reading a script cannot make, and the captured still is what
// the reviewer makes it on. What a script CAN decide is the mechanical half of the
// sentence, which is also the half a build fails: that the screen carries text
// that CHANGES with the highlighted row, a different body for each of the five,
// rather than one paragraph drawn whatever is highlighted or none at all.
//
// HOW "A DIFFERENT BODY FOR EACH" IS READ. The five rows are read one frame each,
// and each row's frame is reduced to the runs of text NO OTHER row's frame drew.
// That difference is the description, whatever a build calls it and wherever it
// put it: the title, the five row labels, the hints and any decoration are drawn
// on all five frames and fall out of it. A build drawing one paragraph for every
// mode has five empty differences and fails on the first row; a build drawing a
// description for the first mode alone fails on the other four; and two rows given
// the SAME description fail together, because text on two frames is unique to
// neither.
//
// WHY THE ROW LABEL IS TAKEN OUT OF THE DIFFERENCE. A build is free to mark the
// highlighted row — `> CONTAINMENT` is a compliant way to draw a menu — and that
// marker alone would make every frame's text differ without a word of description
// anywhere. So every occurrence of a `MODE_ITEMS` label is struck out of the
// difference before it is measured, and what is measured is the LETTERS that
// remain.
//
// A LABELLED FIGURES LINE COUNTS AS A DESCRIPTION, and that is deliberate. The
// sentence asks the body to describe "what that mode is and what it changes", and
// a row of that mode's own starting money, wave count and lives does the second
// half of it — the labels beside those figures are the letters this reads, so a
// build that answers with figures rather than prose is not failed here. Whether
// the first half is answered too is the reviewer's reading, from the still.
//
// THE HIGHLIGHT IS POSED, NOT WALKED, for the reason `screens.menu-wraps-down`
// gives: `setMenuIndex` "Sets the highlighted row of whatever menu the current
// screen shows" (`specs/instrumentation.md`), so a build whose `down` key is
// broken still gets a fair reading of what each row DRAWS — which is this point —
// and grades its broken key at `controls.menu-down`, which is where that
// requirement lives.
//
// "MOVING THE HIGHLIGHT STARTS NOTHING" is read on every one of the five frames:
// the screen must still be `modeselect` at each. A build that opened a run, or the
// difficulty list, on the highlight reaching a row reads a different screen there
// and fails on that row. Where a CONFIRMED row leads is
// `screens.containment-opens-difficulty-select`'s and
// `screens.special-mode-starts-immediately`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { MODE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  drawnText,
  type Harness,
} from "../harness";
import { lettersIn } from "./copy";

/**
 * How many letters of text unique to a row must remain once every row label has
 * been struck out of it: one.
 *
 * `specs/screens.md` asks for "a different body of text for each ... describing
 * what that mode is and what it changes" and fixes not one word of it — not how
 * long it runs, not how it is broken into lines, not what it says. So what is read
 * is whether the row drew a body of its own AT ALL, which is the smallest count
 * there is. How much a row drew and how well it describes its mode are the
 * reviewer's, from the still this point captures. A build drawing one paragraph
 * for every mode, or none, leaves a row nothing of its own and reads 0.
 */
const DESCRIPTION_MIN_LETTERS = 1;

/** The row the still is captured on, so the picture shows a description. */
const CAPTURE_ROW = 1;

/** Every occurrence of any row's label, struck out of a run of text. */
function withoutLabels(text: string): string {
  let stripped = text;
  for (const item of MODE_ITEMS) {
    stripped = stripped.replace(
      new RegExp(item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
      " ",
    );
  }
  return stripped;
}

/**
 * The rows a description is read on: the five that name a mode, in `MODE_ITEMS`
 * order.
 *
 * `BACK` is the sixth row and is excluded, because `specs/screens.md` says of it
 * that it "names no mode and draws no description". Where it leads is
 * `screens.mode-select-back-row`'s.
 */
const MODE_ROWS: readonly number[] = MODE_ITEMS.flatMap((item, row) =>
  item === "BACK" ? [] : [row],
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws a different body of text for each of the five modes", async () => {
  const { debug } = h;
  await debug.reset();
  await debug.setScreen("modeselect");

  // One frame per row, each read with that row highlighted and nothing else
  // touched.
  const frames: string[][] = [];
  for (const row of MODE_ROWS) {
    await debug.setMenuIndex(row);
    const calls = await h.frameCalls();
    if (row === CAPTURE_ROW) await captureStill(h, "description");

    const posed = await h.snapshot();
    assertEqual(
      posed.menuIndex,
      row,
      `the row the screen is posed on, ${MODE_ITEMS[row]}`,
    );
    assertEqual(
      posed.screen,
      "modeselect",
      `the screen with the highlight on ${MODE_ITEMS[row]}, row ${row} of ` +
        `${MODE_ITEMS.length}, since moving the highlight starts nothing ` +
        `(specs/screens.md)`,
    );
    frames.push(drawnText(calls).map((text) => text.trim()));
  }

  for (const [leg, texts] of frames.entries()) {
    const row = MODE_ROWS[leg];
    const elsewhere = new Set(
      frames.flatMap((other, index) => (index === leg ? [] : other)),
    );
    const own = texts.filter((text) => !elsewhere.has(text));
    const letters = lettersIn(own.map(withoutLabels));
    assertGreaterThanOrEqual(
      letters,
      DESCRIPTION_MIN_LETTERS,
      `the letters of text drawn for ${MODE_ITEMS[row]}, row ${row} of ` +
        `${MODE_ITEMS.length}, and for no other row, once every row label is ` +
        `struck out; each mode's description is a different body of text ` +
        `(specs/screens.md). What was unique to this row was ` +
        `${JSON.stringify(own)}`,
    );
  }
});
