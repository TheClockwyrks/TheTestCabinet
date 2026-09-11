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
// between the names rather than assumed. Within a row the name is struck out
// before the digits are read, so a name that carried a digit could not stand in
// for the number, and the reading accepts any presentation of the figure — `1`,
// `01`, `SITE 1` — because `specs/ui.md` fixes the number and not how it is set.
//
// NOTHING IS CLEARED AND NO BEST IS RECORDED, so the only digits on a row are the
// ones this item is about: a recorded score would put a cost and a time on the
// row and neither is a site number.

import { afterEach, beforeEach, it } from "vitest";
import { drawnTextRuns, type TextDraw } from "../case-harness/index";
import { assertTrue, fail } from "../assert";
import { SITE_NAMES } from "../constants";
import { createHarness, type Harness } from "../harness";
import { figuresIn } from "./figures";
import { runStarting } from "./reading";

/* ---- The six rows of the site list ---------------------------------------- */
//
// The rows are read off `h.screenCalls()` — the last CLOSED frame's operations on
// the screen layer, every text call measured — as the logical runs the shared
// harness's `drawnTextRuns` spells, in the reading order it hands them over in:
// down the stage, then across it. A row is found by the run its name starts in
// (`./reading`), and the rest of the row is whatever else those runs put in its
// band.

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
 * `specs/ui.md` says `select` "lists the `SITE_COUNT` (`6`) sites in order, each
 * showing its number, its name, and its state", and fixes the names through
 * `specs/sites.md`; where a build puts a row is the build's. So a row is found by
 * its name and is as wide as half the gap to its neighbours, which reads a list
 * laid out down the stage or across it and holds the list's own heading and
 * footer outside every band.
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

/**
 * The numbers a row's text carries, once the site's name has been struck out of
 * it.
 *
 * READ WITH `figuresIn` RATHER THAN OFF THE PLACED FIGURES, and this is the one
 * suite here for which that is the right half of `./figures`' reading. The row
 * this asks about is not what the frame drew: the site's name is struck out of
 * it first, so a name that carried a digit could not stand in for the number,
 * and the runs that survive are then joined. That string is the CHECK'S, not the
 * build's — the spaces in it are the join's and the merge's, and none of them
 * groups a figure — so it reads under the half of the rule that forbids the
 * ASCII space. The figure this check looks for is a site's number, one through
 * six, which no build has anything to group.
 */
function rowNumbers(
  order: readonly TextDraw[],
  row: Row,
  name: string,
): number[] {
  return figuresIn(
    rowText(order, row)
      .join("\n")
      .replace(new RegExp(name.replace(/ /g, "\\s*"), "gi"), ""),
  );
}

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

  const order = drawnTextRuns(await h.screenCalls());
  await h.capture("select-numbers", "The site numbers");

  assertTrue(
    order.length > 0,
    "the select screen to draw text at all (specs/ui.md)",
  );
  const rows = siteRows(order);

  for (const [index, row] of rows.entries()) {
    const name = SITE_NAMES[index]!;
    if (!rowNumbers(order, row, name).includes(index + 1)) {
      fail(
        `site ${index + 1}'s row to show the number ${index + 1}, its index ` +
          `plus one (specs/ui.md)`,
        `the row beside "${name}" reads ` +
          `${JSON.stringify(rowText(order, row))}`,
      );
    }
  }
});
