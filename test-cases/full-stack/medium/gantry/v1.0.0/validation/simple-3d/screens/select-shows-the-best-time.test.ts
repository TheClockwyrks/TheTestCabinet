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
// time is shown and leaves the setting to the build, so a row is read with its
// spaces and thousands separators removed and the figure is looked for inside
// it: `17.5s`, `17.50` and `0:17.50` all carry the time. What would fail is a
// row that does not show it, or shows a different one.

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
// open. `last()` answers every operation the last CLOSED frame issued, so a
// frame is advanced before it is read.

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
 * Where `wanted` starts among the frame's runs, or `null` when it was not
 * drawn.
 *
 * The frame's text is joined in reading order with every space removed, so copy
 * split across calls, letter-spaced, or padded matches the same as copy drawn
 * in one call; the answer is the index of the run the match starts in, which is
 * what puts two pieces of copy in order. */
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
 * `specs/ui.md` says `select` "lists the `SITE_COUNT` (`6`) sites in order,
 * each showing its number, its name, and its state", and fixes the names
 * through `specs/sites.md`; where a build puts a row is the build's. So a row
 * is found by its name and is as wide as half the gap to its neighbours, which
 * reads a list laid out down the stage or across it and holds the list's own
 * heading and footer outside every band. */
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

/** The site the score is recorded on. */
const SITE = 0;

/** The recorded score: a four-figure cost and a time with a fraction. */
const COST = 2350;
const TIME = 17.5;

/** A row's text with the separators a build may set a figure with removed. */
function figures(text: string): string {
  return text.replace(/[\s,]/g, "");
}

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

  const order = readingOrder(textDraws(await frameOps(h)));
  await h.capture("state", "The best time beside a cleared site");

  assertTrue(
    order.length > 0,
    "the select screen to draw text at all (specs/ui.md)",
  );
  const row = siteRows(order)[SITE]!;
  const written = rowText(order, row);
  const flat = figures(written.join("\n"));

  if (!flat.includes(String(TIME))) {
    fail(
      `site ${SITE + 1}'s row to show its best time, ${TIME} ` +
        "(specs/ui.md)",
      `the row beside "${SITE_NAMES[SITE]}" reads ${JSON.stringify(written)}`,
    );
  }
});
