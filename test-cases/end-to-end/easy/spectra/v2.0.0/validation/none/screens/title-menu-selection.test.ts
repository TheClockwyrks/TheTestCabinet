// Spectra — screens/title-menu-selection: the drawn highlight follows the index.
//
// THE RULE. `specs/ui.md`: "The highlighted item is the one the menu index names,
// counted from `0`, and it is drawn distinctly from the others, so a player always
// sees which item `confirm` would take." `menuIndex` is posed directly, which is
// what `specs/instrumentation.md` provides `setMenuIndex` for, so the menu keys
// — whose own points are `controls/menu-up-*` and `controls/menu-down-*` — cannot
// fail this one.
//
// WHAT IS MEASURED, AND WHY IT IS MEASURED THAT WAY. `specs/ui.md` fixes no
// palette, no type and no layout for the menu, and it does not say WHAT a
// highlight looks like — a colour, a marker, a bar behind the words, a larger
// face are all conformant. So nothing here may assert an appearance. What it
// asserts instead is the pixels: with the index on the first item and again with
// it on the second, the neighbourhood of EACH entry must have been repainted. An
// entry whose drawing is the same at both indices was not drawn distinctly at
// either, which is exactly the failure `specs/ui.md` forbids, and both entries are
// read because a build that repaints only the one it happens to start on has a
// highlight that does not follow the index.
//
// EACH ENTRY'S NEIGHBOURHOOD IS THE BUILD'S OWN. It is the run of text the build
// drew, taken from `textDraws` with the transform in force applied, widened by
// `ENTRY_PAD_X` on each side and `entryHalfHeight` above and below, so a marker or
// a bar drawn beside or behind the words falls inside it. The vertical extent is
// capped at a fraction of the gap the build left between the two entries, so the
// two neighbourhoods cannot overlap and the change read in one cannot be the other
// entry's.
//
// THE CONTROL. A strip of screen that moves on its own — an animated menu, a
// drifting starfield behind it — would let "something changed" pass a build whose
// highlight never moved, so each neighbourhood's own frame-to-frame drift is
// measured first, with nothing posed between the two readings, and the change the
// index causes has to beat it.
//
// WHAT THIS DOES NOT DECIDE, AND SAYS SO. Which of the two treatments is the
// HIGHLIGHTED one. With two entries and no fixed appearance for a highlight, no
// reading of the pixels can tell "the highlight is on the item the index names"
// from "the highlight is on the other one" — a script would have to be told what a
// highlight looks like, which `specs/ui.md` deliberately does not say. The pair of
// captures is what a reviewer decides that from.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, fail } from "../assert";
import { titleItems } from "../constants";
import {
  captureStill,
  createHarness,
  drawnText,
  readRegion,
  textDraws,
  type Harness,
} from "../harness";
import { changedSamples, driftOverOneFrame, entryRegion } from "./reading";

/** The two indices the highlight is posed at: every index TITLE_ITEMS has. */
const FIRST_INDEX = 0;
const SECOND_INDEX = 1;

/**
 * How far a sample must move to count as repainted, as a Euclidean RGB distance
 * out of the `441` an RGB cube is across.
 *
 * The case's figure, since `specs/ui.md` states the rule and leaves the palette to
 * the build: `40` is about a tenth of the space, which is the least a player reads
 * as a different treatment at a glance, and far above the nothing that separates
 * two readings of one unchanged pixel.
 */
const REPAINT_MIN = 40;

/**
 * How many samples of an entry's neighbourhood must be repainted.
 *
 * At the harness's default shape the canvas is the stage at one pixel per unit
 * and the lattice below is one sample every `READ_STEP` units, so `24` samples is
 * about a hundred logical units of the screen — a tenth of the area a single
 * capital letter of legible menu type covers. It is a floor under anti-aliasing
 * noise on one glyph edge rather than a demand on how a build draws its
 * highlight, which `specs/ui.md` leaves open.
 */
const REPAINT_MIN_SAMPLES = 24;

/** One sample every two logical units, in both directions. */
const READ_STEP = 2;

/** How far either side of a run's own span its neighbourhood reaches. */
const ENTRY_PAD_X = 40;

/**
 * The most of the gap between the two entries one neighbourhood may claim, above
 * and below its anchor.
 *
 * Two fifths, so the two never overlap whatever spacing a build chose, and the
 * change read in one entry's square is that entry's.
 */
const ENTRY_GAP_SHARE = 0.4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("repaints each title-menu entry when the highlight index moves to it", async () => {
  await h.advance(1);
  const opened = await h.snapshot();
  assertEqual(
    opened.screen,
    "title",
    "the game opens on the title screen (specs/ui.md)",
  );
  assertEqual(
    opened.menuIndex,
    FIRST_INDEX,
    "with the highlight resting on the first item (specs/ui.md)",
  );

  // Where the build itself drew each entry, so the squares read below are the
  // build's layout rather than the case's.
  const items = titleItems(opened.mode);
  const calls = await h.frameCalls();
  const draws = textDraws(calls);
  const first = draws.find((run) =>
    run.text.toLowerCase().includes(items[0].toLowerCase()),
  );
  const second = draws.find((run) =>
    run.text.toLowerCase().includes(items[1].toLowerCase()),
  );
  if (first === undefined || second === undefined) {
    fail(
      `both TITLE_ITEMS entries (${items.join(", ")}) drawn as runs of text ` +
        "whose anchors can be read (specs/ui.md)",
      JSON.stringify(drawnText(calls)),
    );
  }
  const halfHeight = Math.abs(second.y - first.y) * ENTRY_GAP_SHARE;
  const firstBox = entryRegion(first, ENTRY_PAD_X, halfHeight);
  const secondBox = entryRegion(second, ENTRY_PAD_X, halfHeight);

  // What each square does on its own across one frame, with nothing posed.
  const firstDrift = await driftOverOneFrame(
    h,
    firstBox,
    READ_STEP,
    REPAINT_MIN,
  );
  const secondAtFirstIndex = await readRegion(h, secondBox, READ_STEP);
  const secondDrift = await driftOverOneFrame(
    h,
    secondBox,
    READ_STEP,
    REPAINT_MIN,
  );
  const firstAtFirstIndex = await readRegion(h, firstBox, READ_STEP);

  await h.debug.setMenuIndex(SECOND_INDEX);
  await h.advance(1);
  assertEqual(
    (await h.snapshot()).menuIndex,
    SECOND_INDEX,
    "the highlight index moved to the second item (specs/instrumentation.md)",
  );
  const firstAtSecondIndex = await readRegion(h, firstBox, READ_STEP);
  const secondAtSecondIndex = await readRegion(h, secondBox, READ_STEP);
  await captureStill(h, "highlight");

  const firstMoved = changedSamples(
    firstAtFirstIndex,
    firstAtSecondIndex,
    REPAINT_MIN,
  );
  const secondMoved = changedSamples(
    secondAtFirstIndex,
    secondAtSecondIndex,
    REPAINT_MIN,
  );

  assertGreaterThan(
    firstMoved,
    Math.max(firstDrift.count, REPAINT_MIN_SAMPLES),
    `the ${items[0]} entry drawn differently once the index no longer names ` +
      `it — the highlighted item is the one menuIndex names and is drawn ` +
      `distinctly from the others (specs/ui.md); its square moved on its own ` +
      `across one frame in ${firstDrift.count} samples`,
  );
  assertGreaterThan(
    secondMoved,
    Math.max(secondDrift.count, REPAINT_MIN_SAMPLES),
    `the ${items[1]} entry drawn differently once the index names it — the ` +
      `highlighted item is the one menuIndex names and is drawn distinctly ` +
      `from the others (specs/ui.md); its square moved on its own across one ` +
      `frame in ${secondDrift.count} samples`,
  );
});
