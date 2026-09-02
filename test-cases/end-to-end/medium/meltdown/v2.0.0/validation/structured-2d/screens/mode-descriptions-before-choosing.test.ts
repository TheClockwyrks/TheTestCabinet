// Meltdown — screens/mode-descriptions-before-choosing: each mode reads
// differently before it is chosen.
//
// THE RULE. specs/screens.md, `modeselect`: "Each mode's description is readable
// before it is chosen: moving the highlight across the five rows draws a
// different body of text for each, describing what that mode is and what it
// changes, and moving the highlight starts nothing."
//
// WHAT A SCRIPT CAN DECIDE HERE. Whether a description is a good description is a
// reviewer's judgement and no check's. What the specification states in figures a
// script can read is that there is a body of text BESIDE the list, and that it is
// a DIFFERENT body for each of the five rows — so a build that draws one blurb
// for every mode, or draws none at all, is caught, and a build that describes all
// five differently passes whatever words it chose.
//
// THE ROW NAMES ARE TAKEN OUT OF THE READING FIRST. The list itself is drawn on
// every one of the five frames, and a build free to decorate its highlighted row
// (`> BOTTLENECK`) or to repeat the chosen name as a heading would make the five
// frames differ by that alone — which is the highlight, not a description. So
// every run carrying one of the `MODE_ITEMS` names is dropped, and what is
// compared is the text that is left.
//
// AND IT MUST BE THERE AT ALL. Each of the five frames must leave a non-empty
// body behind, so a build that draws a blurb for one mode and nothing for the
// rest fails naming the row it drew nothing for.
//
// MOVING THE HIGHLIGHT STARTS NOTHING, which is read on every one of the five
// rows: the screen must still be `modeselect` after each. This is the half of the
// rule that keeps a build from opening a run as the highlight passes over a mode.
//
// THE ROW IS POSED, NOT WALKED. `setMenuIndex` sets the highlighted row outright
// (specs/instrumentation.md), so a build whose arrow keys are broken still gets a
// fair reading of its descriptions; those keys are `controls.menu-down` and
// `controls.menu-up`.

import { afterEach, beforeEach, it } from "vitest";
import { MODE_ITEMS } from "../constants";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertNotEqual,
} from "../assert";
import { captureStill, createHarness, resetTo, type Harness } from "../harness";
import { readScreen } from "./menu";

/**
 * The least the body beside the list may hold: one run of text.
 *
 * specs/screens.md asks for "a different body of text" per row and fixes not one
 * thing about how long it is or how it is broken into lines, so the floor is
 * simply that something was drawn.
 */
const MIN_BODY_RUNS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Whether a run of text is one of the list's own rows rather than the body. */
function namesAMode(text: string): boolean {
  const upper = text.trim().toUpperCase();
  return MODE_ITEMS.some((item) => upper.includes(item));
}

it("draws a different body of text for each of the five modes, and starts none of them", async () => {
  resetTo(h);
  h.debug.setScreen("modeselect");

  const bodies: string[][] = [];
  for (const [index, item] of MODE_ITEMS.entries()) {
    h.debug.setMenuIndex(index);
    const runs = await readScreen(h);
    if (index === 0) captureStill(h, "description");

    assertEqual(
      h.snapshot().screen,
      "modeselect",
      `the screen after the highlight moved onto ${item}: moving it starts nothing`,
    );

    const body = runs
      .map((run) => run.text.trim())
      .filter((text) => text.length > 0 && !namesAMode(text));
    assertGreaterThanOrEqual(
      body.length,
      MIN_BODY_RUNS,
      `runs of text drawn beside the list describing ${item}`,
    );
    bodies.push(body);
  }

  const rendered = bodies.map((body) => [...body].sort().join("\n"));
  for (const [index, item] of MODE_ITEMS.entries()) {
    for (const [other, otherItem] of MODE_ITEMS.entries()) {
      if (other <= index) continue;
      assertNotEqual(
        rendered[index],
        rendered[other],
        `the body of text drawn for ${item} differs from the one drawn for ${otherItem}`,
      );
    }
  }
});
