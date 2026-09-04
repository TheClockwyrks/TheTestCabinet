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
import { assertTrue, fail } from "../assert";
import { SITE_NAMES } from "../constants";
import { createHarness, type Harness } from "../harness";
/* -------------------------------------------------------------------------- */
/* Reading the frame's text                                                   */
/* -------------------------------------------------------------------------- */
//
// The harness lifts the clock, the projection and the input out of the surface
// but exposes no reading of the frame's draw operations, so this suite reaches
// the injected recorder over `h.page` — the one escape hatch the harness leaves
// open. `last()` answers every operation the last CLOSED frame issued, so a frame
// is advanced before it is read.

/** One operation the recorder wrote, in the order the render made it. */
type RecordedOp =
  | { op: "call"; method: string; args: unknown[] }
  | { op: "set"; property: string; value: unknown };

/** A 2D affine transform, in the order `setTransform` takes its arguments. */
type Matrix = readonly [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `m` with `n` applied under it, as the canvas composes a transform. */
function mul(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/** Where `(x, y)` lands under `m`. */
function at(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/** `m` after the transform `method` names, or `null` when it names none. */
function moved(m: Matrix, method: string, n: readonly number[]): Matrix | null {
  if (method === "resetTransform") return IDENTITY;
  if (method === "setTransform" && n.length >= 6) {
    return [n[0], n[1], n[2], n[3], n[4], n[5]];
  }
  if (method === "transform" && n.length >= 6) {
    return mul(m, [n[0], n[1], n[2], n[3], n[4], n[5]]);
  }
  if (method === "translate" && n.length >= 2) {
    return mul(m, [1, 0, 0, 1, n[0], n[1]]);
  }
  if (method === "scale" && n.length >= 2) {
    return mul(m, [n[0], 0, 0, n[1], 0, 0]);
  }
  if (method === "rotate" && n.length >= 1) {
    const c = Math.cos(n[0]);
    const s = Math.sin(n[0]);
    return mul(m, [c, s, -s, c, 0, 0]);
  }
  return null;
}

/** One run of text a frame drew, at the point the transform in force put it. */
interface TextDraw {
  text: string;
  x: number;
  y: number;
}

/**
 * Every run of text the frame drew, with its anchor.
 *
 * A build is free to draw under a transform — to translate to a corner of the
 * stage and draw at the origin — so where a `fillText` landed is only the point
 * it names once the transform in force at that call is applied.
 */
function textDraws(ops: readonly RecordedOp[]): TextDraw[] {
  const out: TextDraw[] = [];
  const stack: Matrix[] = [];
  let m = IDENTITY;
  for (const op of ops) {
    if (op.op !== "call") continue;
    const n = op.args.filter((a): a is number => typeof a === "number");
    if (op.method === "save") {
      stack.push(m);
      continue;
    }
    if (op.method === "restore") {
      m = stack.pop() ?? IDENTITY;
      continue;
    }
    const next = moved(m, op.method, n);
    if (next !== null) {
      m = next;
      continue;
    }
    if (
      (op.method === "fillText" || op.method === "strokeText") &&
      typeof op.args[0] === "string" &&
      n.length >= 2
    ) {
      out.push({ text: op.args[0], ...at(m, n[0], n[1]) });
    }
  }
  return out;
}

/** Two runs are on one line when their anchors sit this close in `y`. */
const LINE_TOL = 4;

/** The frame's runs of text in reading order: down the stage, then across. */
function readingOrder(draws: readonly TextDraw[]): TextDraw[] {
  return [...draws].sort((a, b) =>
    Math.abs(a.y - b.y) > LINE_TOL ? a.y - b.y : a.x - b.x,
  );
}

/**
 * Where `wanted` starts among the frame's runs, or `null` when it was not drawn.
 *
 * The frame's text is joined in reading order with every space removed, so copy
 * split across calls, letter-spaced, or padded matches the same as copy drawn in
 * one call; the answer is the index of the run the match starts in, which is what
 * puts two pieces of copy in order.
 */
function findText(order: readonly TextDraw[], wanted: string): number | null {
  const needle = wanted.replace(/\s+/g, "").toLowerCase();
  let joined = "";
  const owner: number[] = [];
  order.forEach((draw, index) => {
    const bare = draw.text.replace(/\s+/g, "").toLowerCase();
    joined += bare;
    for (let k = 0; k < bare.length; k += 1) owner.push(index);
  });
  const found = joined.indexOf(needle);
  return found < 0 ? null : owner[found]!;
}

/** Every operation the last closed frame's render issued. */
async function frameOps(harness: Harness): Promise<RecordedOp[]> {
  return await harness.screenOps();
}

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
 * `specs/ui.md` says `select` "lists the `SITE_COUNT` (`6`) sites in order, each
 * showing its number, its name, and its state", and fixes the names through
 * `specs/sites.md`; where a build puts a row is the build's. So a row is found by
 * its name and is as wide as half the gap to its neighbours, which reads a list
 * laid out down the stage or across it and holds the list's own heading and
 * footer outside every band.
 */
function siteRows(order: readonly TextDraw[]): Row[] {
  const anchors = SITE_NAMES.map((name, index) => {
    const found = findText(order, name);
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

/** The numbers a run of text carries. */
function numbersIn(text: string): number[] {
  return (text.match(/\d+/g) ?? []).map((run) => Number(run));
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

  const order = readingOrder(textDraws(await frameOps(h)));
  assertTrue(
    order.length > 0,
    "the select screen to draw text at all (specs/ui.md)",
  );
  const rows = siteRows(order);

  for (const [index, row] of rows.entries()) {
    const name = SITE_NAMES[index]!;
    const written = rowText(order, row)
      .join("\n")
      .replace(new RegExp(name.replace(/ /g, "\\s*"), "gi"), "");
    if (!numbersIn(written).includes(index + 1)) {
      fail(
        `site ${index + 1}'s row to show the number ${index + 1}, its index ` +
          `plus one (specs/ui.md)`,
        `the row beside "${name}" reads ` +
          `${JSON.stringify(rowText(order, row))}`,
      );
    }
  }

  await h.capture("select-numbers", "The site numbers");
});
