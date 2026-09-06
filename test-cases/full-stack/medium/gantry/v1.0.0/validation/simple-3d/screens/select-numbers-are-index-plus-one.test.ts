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
import {
  figureRuns,
  figuresIn,
  type DrawnCopy,
  type FigureRun,
} from "./figures";
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
//
// A row's NUMBER is read off both the runs and the raw draws that spelled them
// (`./figures`), because the ASCII space cuts two ways: one the BUILD wrote
// inside a single draw groups the figure it sits in — this case's own reference
// sets a cost that way — while one the MERGE wrote between two draws groups
// nothing, the figures either side of it having been drawn apart.

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
function siteRows(order: readonly FigureRun[]): Row[] {
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
function rowText(order: readonly FigureRun[], row: Row): FigureRun[] {
  return order.filter((draw) => inRow(row, draw));
}

/**
 * A row's copy with the site's own name struck out of it, in the two forms a
 * figure is read off (`./figures`).
 *
 * The name is struck so that a site whose name carried a digit could not be
 * read as showing the row's number, and `\s*` between the name's words strikes
 * it however the frame broke it up — inside one run, and across the join
 * between two.
 *
 * The RAW DRAWS are struck one at a time, which reaches a name the build drew
 * in one call. A name it letter-spaced a glyph per call survives the strike
 * there, and carries nothing into the reading when it does: every part of it is
 * then a single letter, and a letter is not a figure.
 */
function withoutName(runs: readonly FigureRun[], name: string): DrawnCopy {
  const spelled = new RegExp(name.replace(/ /g, "\\s*"), "gi");
  return {
    text: runs
      .map((run) => run.text)
      .join("\n")
      .replace(spelled, ""),
    parts: runs
      .flatMap((run) => run.parts)
      .map((part) => part.replace(spelled, "")),
  };
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

  const order = figureRuns(await h.screenCalls());
  await h.capture("select-numbers", "The site numbers");

  assertTrue(
    order.length > 0,
    "the select screen to draw text at all (specs/ui.md)",
  );
  const rows = siteRows(order);

  for (const [index, row] of rows.entries()) {
    const name = SITE_NAMES[index]!;
    const written = withoutName(rowText(order, row), name);
    if (!figuresIn(written).includes(index + 1)) {
      fail(
        `site ${index + 1}'s row to show the number ${index + 1}, its index ` +
          `plus one (specs/ui.md)`,
        `the row beside "${name}" reads ` +
          `${JSON.stringify(rowText(order, row).map((run) => run.text))}`,
      );
    }
  }
});
