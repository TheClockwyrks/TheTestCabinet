// screens/select-shows-the-best-time — a cleared site shows its best time.
//
// `specs/ui.md` § The screens, Site select: "`select` lists the `SITE_COUNT`
// (`6`) sites in order, each showing its number, its name, and its state:
// locked, open, or cleared, with a cleared site's best score, cost and time,
// beside it."
//
// THE SCORE IS TWO FIGURES, AND EACH IS A CHECK OF ITS OWN: a row that shows
// the best cost and forgets the best time has to grade above a row that shows
// neither. This one decides the time; the cost is
// `screens/select-shows-the-best-cost`.
//
// THE SCORE IS POSED, NOT EARNED. `setBest` "records `{ cost, time }` as site
// `index`'s best score, whatever it held" and `setCleared` "sets whether site
// `index` has been cleared this session" (`specs/instrumentation.md`), which
// are the two preconditions a clear leaves; running a tape to a real clear
// would grade the statics, the rigging and the recording rule on the way to a
// question about what one row draws. Which score a clear records is its own
// review point.
//
// THE FIGURE IS READ WITHOUT FIXING ITS FORMAT. `specs/ui.md` fixes that the
// time is shown and leaves the setting to the build, so the row is read for the
// FIGURES drawn on it rather than for a string: `17.5s`, `17.50` and `0:17.50` all carry the time.
// `./figures` is where that reading lives, and it is what settles the one form
// that is genuinely ambiguous — an ASCII space groups a figure where the build
// wrote it inside a single draw, and parts two figures where the merge wrote it
// between two draws a word apart. What would fail is a row that does not show
// the figure, or shows a different one.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue, fail } from "../assert";
import type { TextDraw } from "../case-harness/text";
import { drawnFigures } from "./figures";
import { SITE_NAMES } from "../constants";
import { createHarness, type Harness } from "../harness";
import { runStarting } from "./reading";

/* -------------------------------------------------------------------------- */
/* Reading the frame's text                                                   */
/* -------------------------------------------------------------------------- */
//
// The frame's text is read through `h.screenCalls()`, the harness's record of
// every operation the last CLOSED frame made on the screen layer with each text
// call measured, so a frame is advanced before it is read. The runs come back
// coalesced by `drawnTextRuns` (`case-harness/text.ts`): a build that
// letter-spaces a row's name or its figure draws a glyph per `fillText`, and
// the specification fixes what a row shows and not how it is set, so the row is
// read off the logical runs it spells and never off the call split. Every raw
// string is a substring of its run, so coalescing can only add a match.
//
// The runs arrive in reading order — down the stage, then across it — and a
// row is found by the run its name starts in (`./reading`).

/* ---- The six rows of the site list ---------------------------------------- */

/** One row of the list: where its name was drawn, and the band it occupies. */
interface Row {
  readonly at: { readonly x: number; readonly y: number };
  /** Half the gap to the next row on each axis; `Infinity` where rows do not
   * differ on that axis at all, which is a list rather than a grid. */
  readonly half: { readonly x: number; readonly y: number };
}

/**
 * The six rows, located by where the frame drew each site's name.
 *
 * `specs/ui.md` says `select` "lists the `SITE_COUNT` (`6`) sites in order,
 * each showing its number, its name, and its state", and fixes the names
 * through `specs/sites.md`; where a build puts a row is the build's. So a row
 * is found by its name and is as wide as half the gap to its neighbours, which
 * reads a list laid out down the stage or across it and holds the list's own
 * heading and footer outside every band.
 *
 * A GRID IS A LIST TOO. `specs/ui.md` fixes that the six sites are listed in
 * order and nothing about how they are arranged, so a build is free to set them
 * out two columns by three — and then no single axis tells the six names apart,
 * three of them sharing each column and two each row. The one axis is tried
 * first, which is what a list down the stage or across it reads as; only where
 * it leaves two names in one band is the other axis brought in, and then a row
 * is the cell where the two bands cross. Six names in one place is the only
 * arrangement left with no rows in it, and that is what the failure below says.
 */
function siteRows(order: readonly TextDraw[]): Row[] {
  const anchors = SITE_NAMES.map((name, index) => {
    const found = runStarting(order, name);
    if (found === null) {
      fail(
        `site ${index + 1}'s name, "${name}", drawn on the select screen ` +
          "(specs/ui.md)",
        `the frame drew ${JSON.stringify(order.map((d) => d.text))}`,
      );
    }
    return order[found]!;
  });
  const spread = (values: number[]): number =>
    Math.max(...values) - Math.min(...values);
  const gapAlong = (values: number[]): number => {
    const sorted = [...values].sort((p, q) => p - q);
    let gap = Number.POSITIVE_INFINITY;
    for (let i = 1; i < sorted.length; i += 1) {
      const apart = sorted[i]! - sorted[i - 1]!;
      if (apart > 0) gap = Math.min(gap, apart);
    }
    return gap;
  };
  const xs = anchors.map((a) => a.x);
  const ys = anchors.map((a) => a.y);
  // The one axis first: the one the names are most spread along, which is the
  // list read down the stage or across it. Its band is half the gap between
  // neighbouring names, and where that gap is positive for every pair the
  // reading is the list's, with nothing bounding the row's own width.
  const alone: "x" | "y" = spread(ys) >= spread(xs) ? "y" : "x";
  const along = alone === "y" ? ys : xs;
  const sorted = [...along].sort((p, q) => p - q);
  let least = Number.POSITIVE_INFINITY;
  for (let i = 1; i < sorted.length; i += 1) {
    least = Math.min(least, sorted[i]! - sorted[i - 1]!);
  }
  const half =
    least > 0 && Number.isFinite(least)
      ? {
          x: alone === "x" ? least / 2 : Number.POSITIVE_INFINITY,
          y: alone === "y" ? least / 2 : Number.POSITIVE_INFINITY,
        }
      : { x: gapAlong(xs) / 2, y: gapAlong(ys) / 2 };
  // Neither axis bounding a row is six names in one place: nothing separates
  // them, so there are no rows to read.
  if (!Number.isFinite(half.x) && !Number.isFinite(half.y)) {
    fail(
      "the six sites listed one row apart (specs/ui.md)",
      "two rows' names were drawn at the same place",
    );
  }
  return anchors.map((a) => ({ at: { x: a.x, y: a.y }, half }));
}

/** Whether something drawn at `p` belongs to `row`. */
function inRow(row: Row, p: { x: number; y: number }): boolean {
  return (
    Math.abs(p.x - row.at.x) <= row.half.x &&
    Math.abs(p.y - row.at.y) <= row.half.y
  );
}

/** The runs of text the frame drew inside `row`, in reading order. */
function rowText(order: readonly TextDraw[], row: Row): string[] {
  return order.filter((draw) => inRow(row, draw)).map((draw) => draw.text);
}

/* -------------------------------------------------------------------------- */

/** The site the score is recorded on. */
const SITE = 0;

/** The recorded score: a four-figure cost and a time with a fraction. */
const COST = 2350;
const TIME = 17.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows a cleared site's best time on its row", async () => {
  await h.debug.reset();
  await h.debug.setBest(SITE, COST, TIME);
  await h.debug.setCleared(SITE, true);
  await h.debug.setScreen("select");
  await h.debug.setMenuIndex(SITE);
  await h.advance(1);

  const posed = await h.snapshot();
  assertTrue(
    posed.cleared[SITE] === true,
    `site ${SITE + 1} standing cleared, which is what puts a score on its row`,
  );

  const frame = drawnFigures(await h.screenCalls());
  const order = frame.runs;
  await h.capture("state", "The best time beside a cleared site");

  assertTrue(
    order.length > 0,
    "the select screen to draw text at all (specs/ui.md)",
  );
  const row = siteRows(order)[SITE]!;
  const written = rowText(order, row);
  // The row's figures are read by its BAND rather than out of the text above:
  // scoping the placement is what puts the raw draws under the row into the
  // reading beside the runs over them, which is what a figure a space groups
  // inside one call needs.
  const shown = frame.where((placed) => inRow(row, placed));

  if (!shown.includes(TIME)) {
    fail(
      `site ${SITE + 1}'s row to show its best time, ${TIME} ` +
        "(specs/ui.md)",
      `the row beside "${SITE_NAMES[SITE]}" reads ${JSON.stringify(written)}`,
    );
  }
});
