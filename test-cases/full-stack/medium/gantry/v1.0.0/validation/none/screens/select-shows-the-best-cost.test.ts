// screens/select-shows-the-best-cost — a cleared site shows its best cost.
//
// `specs/ui.md` § The screens, Site select: "`select` lists the `SITE_COUNT`
// (`6`) sites in order, each showing its number, its name, and its state:
// locked, open, or cleared, with a cleared site's best score, cost and time,
// beside it."
//
// THE SCORE IS TWO FIGURES, AND EACH IS A CHECK OF ITS OWN: a row that shows
// the best cost and forgets the best time has to grade above a row that shows
// neither. This one decides the cost; the time is
// `screens/select-shows-the-best-time`.
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
// cost is shown and leaves the setting to the build, so the row's figures are
// read through `./figures` — this directory's one reading of a number — and
// `2 350`, `2,350` and `2350` all read as the cost. What would fail is a row
// that does not show it, or shows a different one.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue, fail } from "../assert";
import { drawnTextRuns, type TextDraw } from "../case-harness/index";
import { SITE_NAMES } from "../constants";
import { createHarness, type Harness } from "../harness";
import { drawnFigures, type DrawnFigure } from "./figures";
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

/** One row of the list: the axis the rows run along, and the band it occupies. */
interface Row {
  readonly axis: "x" | "y";
  readonly at: number;
  readonly half: number;
}

/**
 * The six rows, located by where the frame drew each site's name.
 *
 * `specs/ui.md` says `select` "lists the `SITE_COUNT` (`6`) sites in order,
 * each showing its number, its name, and its state", and fixes the names
 * through `specs/sites.md`; where a build puts a row is the build's. So a row
 * is found by its name and is as wide as half the gap to its neighbours, which
 * reads a list laid out down the stage or across it and holds the list's own
 * heading and footer outside every band. */
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

/**
 * Every figure the frame drew inside `row`.
 *
 * Read off `./figures`, this directory's one reading of a number, rather than
 * off the row's text joined: a figure is placed at the RUN it was read inside,
 * so it belongs to the row that run was drawn in, and no figure is ever fused
 * out of two runs that a join happened to put a space between.
 */
function rowFigures(drawn: readonly DrawnFigure[], row: Row): number[] {
  return drawn
    .filter((figure) => inRow(row, figure.run))
    .map((figure) => figure.value);
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

it("shows a cleared site's best cost on its row", async () => {
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

  const calls = await h.screenCalls();
  const order = drawnTextRuns(calls);
  await h.capture("state", "The best cost beside a cleared site");

  assertTrue(
    order.length > 0,
    "the select screen to draw text at all (specs/ui.md)",
  );
  const row = siteRows(order)[SITE]!;
  const written = rowText(order, row);
  const shown = rowFigures(drawnFigures(calls), row);

  if (!shown.includes(COST)) {
    fail(
      `site ${SITE + 1}'s row to show its best cost, ${COST} ` +
        "(specs/ui.md)",
      `the row beside "${SITE_NAMES[SITE]}" reads ${JSON.stringify(written)}`,
    );
  }
});
