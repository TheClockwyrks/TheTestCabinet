// screens/select-numbers-are-index-plus-one — a site's displayed number is its
// index plus one.
//
// `specs/ui.md` § The screens, Site select: "`select` lists the `SITE_COUNT`
// (`6`) sites in order, each showing its number, its name, and its state ... A
// site's displayed number is its index plus one, so the first site is index `0`
// and shows as `1`."
//
// EVERY ROW, NOT ONE. The rule is an arithmetic one, and the two mistakes it
// exists to catch — numbering from `0`, and numbering the list backwards — each
// show on some rows and not others, so all six are read and each is required to
// carry its own number.
//
// A ROW IS FOUND BY ITS NAME, because that is the other thing the same sentence
// says every row shows and `specs/sites.md` fixes the six names. Where a build
// puts the rows is the build's, so the band a row owns is derived from the gap
// between the names rather than assumed. The row is then read WHOLE, as the
// frame drew it: none of the six names `specs/sites.md` fixes carries a digit,
// so striking a name out before reading the digits could only splice the text on
// either side of it together into a figure the row never showed. The reading
// accepts any presentation of the figure — `1`, `01`, `SITE 1` — because
// `specs/ui.md` fixes the number and not how it is set, and `./figures` is where
// this project's one reading of a figure lives.
//
// NOTHING IS CLEARED AND NO BEST IS RECORDED, so the only digits on a row are the
// ones this item is about: a recorded score would put a cost and a time on the
// row and neither is a site number.

import { afterEach, beforeEach, it } from "vitest";
import type { TextDraw } from "../case-harness/text";
import { drawnFigures } from "./figures";
import { assertTrue, fail } from "../assert";
import { SITE_NAMES } from "../constants";
import { createHarness, type Harness } from "../harness";
import { runStarting } from "./reading";

/* ---- The six rows of the site list ---------------------------------------- */
//
// The rows are read off `h.screenCalls()` — the last CLOSED frame's operations on
// the screen layer, every text call measured — as the logical runs the shared
// harness's `drawnTextRuns` spells, in the reading order it hands them over in:
// down the stage, then across it. A row is found by the run its name starts in
// (`./reading`), and the rest of the row is whatever else those runs put in its
// band.

/** One row of the list: the axis the rows run along, and the band it occupies. */
interface Row {
  readonly axis: "x" | "y";
  readonly at: number;
  readonly half: number;
}

/**
 * The six rows, located by where the frame drew each site's name.
 *
 * `specs/ui.md` says `select` "lists the `SITE_COUNT` (`6`) sites in order, each
 * showing its number, its name, and its state", and fixes the names through
 * `specs/sites.md`; where a build puts a row is the build's. So a row is found by
 * its name and is as wide as half the gap to its neighbours, which reads a list
 * laid out down the stage or across it and holds the list's own heading and
 * footer outside every band.
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
  const axis: "x" | "y" =
    spread(anchors.map((a) => a.y)) >= spread(anchors.map((a) => a.x))
      ? "y"
      : "x";
  const along = anchors.map((a) => (axis === "y" ? a.y : a.x));
  const sorted = [...along].sort((p, q) => p - q);
  let gap = Number.POSITIVE_INFINITY;
  for (let i = 1; i < sorted.length; i += 1) {
    gap = Math.min(gap, sorted[i]! - sorted[i - 1]!);
  }
  if (!(gap > 0) || !Number.isFinite(gap)) {
    fail(
      "the six sites listed one row apart (specs/ui.md)",
      "two rows' names were drawn at the same place",
    );
  }
  return along.map((a) => ({ axis, at: a, half: gap / 2 }));
}

/** Whether something drawn at `p` belongs to `row`. */
function inRow(row: Row, p: { x: number; y: number }): boolean {
  return Math.abs((row.axis === "y" ? p.y : p.x) - row.at) <= row.half;
}

/** The runs of text the frame drew inside `row`, in reading order. */
function rowText(order: readonly TextDraw[], row: Row): string[] {
  return order.filter((draw) => inRow(row, draw)).map((draw) => draw.text);
}

/* -------------------------------------------------------------------------- */

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("numbers each site row with its index plus one", async () => {
  await h.debug.reset();
  await h.debug.setScreen("select");
  await h.debug.setMenuIndex(0);
  await h.advance(1);

  const frame = drawnFigures(await h.screenCalls());
  const order = frame.runs;
  await h.capture("select-numbers", "The site numbers");

  assertTrue(
    order.length > 0,
    "the select screen to draw text at all (specs/ui.md)",
  );
  const rows = siteRows(order);

  for (const [index, row] of rows.entries()) {
    const name = SITE_NAMES[index]!;
    // The row's figures are read by its BAND rather than out of a string
    // assembled from the runs, which is what puts the raw draws under the row
    // into the reading beside the runs over them (`./figures`).
    if (!frame.where((placed) => inRow(row, placed)).includes(index + 1)) {
      fail(
        `site ${index + 1}'s row to show the number ${index + 1}, its index ` +
          `plus one (specs/ui.md)`,
        `the row beside "${name}" reads ` +
          `${JSON.stringify(rowText(order, row))}`,
      );
    }
  }
});
