// screens/select-state-not-by-hue-alone — the three site states are told apart
// with the colour taken out.
//
// `specs/ui.md` § The screens, Site select, the last sentence of the paragraph
// that fixes the list: "A site's state reads without relying on hue alone."
//
// THE READING IS THE FRAME WITH ITS COLOUR REMOVED. Every operation the row drew
// is kept — the words, the shapes, the weights, the line widths — and the fill,
// stroke and shadow colours are dropped, which is the row as a player who cannot
// separate the hues reads it. If the three states still draw three different
// rows, the state reads without the hue; if two of them collapse onto the same
// drawing, the only thing that told them apart was the colour, which is the miss.
//
// ONE ROW READ THREE TIMES, NOT THREE ROWS READ ONCE. Two rows differ in their
// number and their name whatever their states, and in whatever a build's layout
// gives the first or the last row of a list, so a comparison across rows could
// find a difference that is not the state at all. Site `2`'s row is read in each
// of the three states instead, which `setCleared` reaches without touching
// anything else: `reset` leaves it locked, clearing site `1` opens it, and
// clearing site `2` itself leaves it cleared (`specs/ui.md`,
// `specs/instrumentation.md`).
//
// ALL THREE STATES, because the requirement is that each of `locked`, `open` and
// `cleared` is told from the others: a build that marks a cleared site with a
// tick and leaves `open` and `locked` differing only in hue has missed it on the
// pair that matters.
//
// WHAT IS SET ASIDE, and why each has to be. The row's number is flattened —
// every run of digits becomes a `#` — and its name struck out, so the reading is
// of the state and not of the identity a row carries into every state. No best
// score is recorded, since a score is a second thing a cleared row draws. And the
// highlight is parked on the last row, because a menu marks the row it
// highlights and that mark is not a state either.

import { afterEach, beforeEach, it } from "vitest";
import {
  apply,
  drawnTextRuns,
  IDENTITY,
  transformed,
  type DrawCall,
  type Matrix,
  type TextDraw,
} from "../case-harness/index";
import { assertTrue, fail } from "../assert";
import { SITE_COUNT, SITE_NAMES } from "../constants";
import { createHarness, type Harness } from "../harness";
import { runStarting } from "./reading";

/* ---- The six rows of the site list ---------------------------------------- */
//
// The frame is read twice over, both off `h.screenCalls()` — the last CLOSED
// frame's operations on the screen layer, every text call measured. The site
// names are found among the logical runs the shared harness's `drawnTextRuns`
// spells, in the reading order it hands them over in, and the run each name
// starts in (`./reading`) is what places its row. Everything the row then DREW is
// walked raw, below: that is a comparison of marks and styles between two
// readings of one row, not a reading of copy, and it is not a package reader.

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

/* ---- What one row draws --------------------------------------------------- */

/** The style properties that carry hue, and the ones that carry shape. */
const HUE_PROPS = ["fillStyle", "strokeStyle", "shadowColor"] as const;
const SHAPE_PROPS = [
  "font",
  "lineWidth",
  "lineCap",
  "lineJoin",
  "textAlign",
  "textBaseline",
  "globalAlpha",
] as const;

/** Coordinates are compared to a tenth of a unit: draw calls carry no noise. */
function round(value: number): number {
  return Math.round(value * 10) / 10 + 0;
}

/**
 * `text` with everything that is a row's identity rather than its state removed.
 *
 * A row shows "its number, its name, and its state" (`specs/ui.md`), and the
 * first two differ between any two rows whatever the states are — so a comparison
 * that kept them would find every pair of rows different and decide nothing. The
 * name is struck out and every run of digits becomes a `#`, which leaves `01` and
 * `02` alike, `SITE 1` and `SITE 2` alike, and `CLEARED`, `OPEN` and `LOCKED`
 * exactly as the build drew them.
 */
function stateText(text: string, index: number): string {
  const name = SITE_NAMES[index]!.replace(/ /g, "\\s*");
  return text
    .toUpperCase()
    .replace(new RegExp(name, "gi"), "")
    .replace(/\d+/g, "#")
    .trim();
}

/**
 * What each row drew, as a list of tokens comparable between rows.
 *
 * Every drawing operation is placed in the row its first point falls in, written
 * relative to that row's own position so two rows drawing the same thing in
 * different places produce the same token, and carried with the context state in
 * force. `hue` is what separates the two questions this reading answers: with it
 * the comparison is of everything the rows draw, and without it the fill, stroke
 * and shadow colours are dropped, so what is left is the picture with the colour
 * taken out.
 */
function rowMarks(
  calls: readonly DrawCall[],
  rows: readonly Row[],
  hue: boolean,
): string[][] {
  const marks: string[][] = rows.map(() => []);
  const stack: Matrix[] = [];
  const style = new Map<string, unknown>();
  const props = hue ? [...SHAPE_PROPS, ...HUE_PROPS] : [...SHAPE_PROPS];
  let m: Matrix = IDENTITY;
  let last = -1;
  for (const call of calls) {
    if (call.kind === "set") {
      style.set(call.property, call.value);
      continue;
    }
    const { method, args } = call;
    if (method === "save") {
      stack.push(m);
      continue;
    }
    if (method === "restore") {
      m = stack.pop() ?? IDENTITY;
      continue;
    }
    const next = transformed(m, method, args);
    if (next !== null) {
      m = next;
      continue;
    }
    // `fill`, `stroke` and `closePath` carry no coordinates, and they are what
    // separates an outlined mark from a filled one — so each belongs to the row
    // the path before it was drawn in.
    if (method === "fill" || method === "stroke" || method === "closePath") {
      if (last >= 0) marks[last]!.push(method);
      continue;
    }
    const n = args.filter((a): a is number => typeof a === "number");
    if (n.length < 2) continue;
    // A text call the recorder measured carries the transform it was really
    // made under; the walk stands in where it did not, which is how the shared
    // `textDraws` places the same call, so a mark lands in the row its name did.
    const placed = call.text?.transform ?? m;
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i + 1 < n.length; i += 2)
      points.push(apply(placed, n[i]!, n[i + 1]!));
    const index = rows.findIndex((row) => inRow(row, points[0]!));
    if (index < 0) continue;
    const row = rows[index]!;
    let text: string | null = null;
    if (typeof args[0] === "string") {
      text = stateText(args[0], index);
      if (text === "") continue;
    }
    last = index;
    const where = points
      .map((p) =>
        row.axis === "y"
          ? `${round(p.x)},${round(p.y - row.at)}`
          : `${round(p.x - row.at)},${round(p.y)}`,
      )
      .join(" ");
    const set = props.map((p) => `${p}=${String(style.get(p))}`).join(";");
    marks[index]!.push(`${method}|${text ?? ""}|${where}|${set}`);
  }
  return marks;
}

/* -------------------------------------------------------------------------- */

/** The row read in all three states: site 2, which every state can reach. */
const SITE = 1;

/** How each state is posed on that row, and what it is called in a verdict. */
const STATES = [
  { name: "locked", clear: null },
  { name: "open", clear: SITE - 1 },
  { name: "cleared", clear: SITE },
] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Pose the list with `clear` cleared, and read what site 2's row draws. */
async function rowWith(clear: number | null): Promise<string> {
  await h.debug.reset();
  if (clear !== null) await h.debug.setCleared(clear, true);
  await h.debug.setScreen("select");
  // Parked off the row under test: a menu marks the row it highlights.
  await h.debug.setMenuIndex(SITE_COUNT - 1);
  await h.advance(1);

  const calls = await h.screenCalls();
  const order = drawnTextRuns(calls);
  assertTrue(
    order.length > 0,
    "the select screen to draw text at all (specs/ui.md)",
  );
  const rows = siteRows(order);
  return rowMarks(calls, rows, false)[SITE]!.join("\n");
}

it("tells cleared, open and locked apart with the hue removed", async () => {
  const drawn: string[] = [];
  for (const state of STATES) drawn.push(await rowWith(state.clear));

  await h.capture("select-grayscale", "The select rows in their three states");

  for (const [a, b] of [
    [0, 1],
    [0, 2],
    [1, 2],
  ] as const) {
    if (drawn[a] === drawn[b]) {
      fail(
        `site ${SITE + 1}'s row to be drawn differently when it is ` +
          `${STATES[a].name} from when it is ${STATES[b].name}, with the ` +
          "fill, stroke and shadow colours dropped, so its state reads " +
          "without relying on hue alone (specs/ui.md)",
        `with the colour removed the row beside "${SITE_NAMES[SITE]}" draws ` +
          `the same thing ${STATES[a].name} as it does ${STATES[b].name}`,
      );
    }
  }
});
