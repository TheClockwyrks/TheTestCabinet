// screens/select-shows-a-cleared-site-as-cleared — a cleared row is drawn
// differently from the same row when it is merely open.
//
// `specs/ui.md` § The screens, Site select: "`select` lists the `SITE_COUNT`
// (`6`) sites in order, each showing its number, its name, and its state: locked,
// open, or cleared." A row that shows its state has to draw a cleared site
// differently from a site that is only open, or the state is not on the row at
// all.
//
// ONE ROW READ TWICE, NOT TWO ROWS READ ONCE. Two rows differ in their number and
// their name whatever their states, and in whatever a build's layout gives the
// first row of a list — so a comparison across rows can find a difference that is
// not the state and decide nothing. The same row read in two states differs in
// the state and in nothing else: `reset` leaves site `1` open
// (`specs/instrumentation.md`), `setCleared(0, true)` "sets whether site `index`
// has been cleared this session" and leaves everything else where it was, and
// what the row draws either side of that is the reading.
//
// NO BEST SCORE IS RECORDED, because a cleared site's score is a second thing its
// row draws (`specs/ui.md`) and it has its own review point; a score would make
// the two readings differ whether or not the state does. The highlight is parked
// on the last row, because a menu marks the row it highlights and that mark is
// not a state either.
//
// WHAT IS COMPARED IS EVERYTHING THE ROW DRAWS — its words, its shapes, its
// weights and its colours — with the row's own identity taken out and every
// coordinate written relative to the row's position. Whether the difference is a
// word, a mark or a hue is the build's business; that there IS one is the
// requirement. Whether it survives the colour being removed is a separate item.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue, fail } from "../assert";
import { SITE_COUNT, SITE_NAMES } from "../constants";
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

/** The page global the shared harness installs its draw recorder on. */
const RECORDER = "__tcabRec";

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
  return (await harness.page.evaluate(
    (global) =>
      (window as unknown as Record<string, { last(): unknown[] }>)[
        global
      ]!.last(),
    RECORDER,
  )) as RecordedOp[];
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
  ops: readonly RecordedOp[],
  rows: readonly Row[],
  hue: boolean,
): string[][] {
  const marks: string[][] = rows.map(() => []);
  const stack: Matrix[] = [];
  const style = new Map<string, unknown>();
  const props = hue ? [...SHAPE_PROPS, ...HUE_PROPS] : [...SHAPE_PROPS];
  let m = IDENTITY;
  let last = -1;
  for (const op of ops) {
    if (op.op === "set") {
      style.set(op.property, op.value);
      continue;
    }
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
    // `fill`, `stroke` and `closePath` carry no coordinates, and they are what
    // separates an outlined mark from a filled one — so each belongs to the row
    // the path before it was drawn in.
    if (
      op.method === "fill" ||
      op.method === "stroke" ||
      op.method === "closePath"
    ) {
      if (last >= 0) marks[last]!.push(op.method);
      continue;
    }
    if (n.length < 2) continue;
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i + 1 < n.length; i += 2)
      points.push(at(m, n[i]!, n[i + 1]!));
    const index = rows.findIndex((row) => inRow(row, points[0]!));
    if (index < 0) continue;
    const row = rows[index]!;
    let text: string | null = null;
    if (typeof op.args[0] === "string") {
      text = stateText(op.args[0], index);
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
    marks[index]!.push(`${op.method}|${text ?? ""}|${where}|${set}`);
  }
  return marks;
}

/* -------------------------------------------------------------------------- */

/** The row read in both states: site 1, which a fresh game leaves open. */
const SITE = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Pose the list with site 1 cleared or not, and read what its row draws. */
async function rowAs(cleared: boolean): Promise<string> {
  await h.debug.reset();
  if (cleared) await h.debug.setCleared(SITE, cleared);
  await h.debug.setScreen("select");
  // Parked off the row under test: a menu marks the row it highlights.
  await h.debug.setMenuIndex(SITE_COUNT - 1);
  await h.advance(1);

  const posed = await h.snapshot();
  assertTrue(
    posed.cleared[SITE] === cleared,
    `site ${SITE + 1} standing ${cleared ? "cleared" : "uncleared"} for this ` +
      "reading",
  );

  const ops = await frameOps(h);
  const order = readingOrder(textDraws(ops));
  assertTrue(
    order.length > 0,
    "the select screen to draw text at all (specs/ui.md)",
  );
  const rows = siteRows(order);
  return rowMarks(ops, rows, true)[SITE]!.join("\n");
}

it("draws a site's row differently once it is cleared", async () => {
  const open = await rowAs(false);
  const cleared = await rowAs(true);

  // The still is the list a reviewer reads: site 1 cleared, site 2 open behind
  // it, and the rest locked.
  await h.capture("select-states", "A cleared row beside an open row");

  if (open === cleared) {
    fail(
      `site ${SITE + 1}'s row to be drawn differently when it is cleared from ` +
        "when it is only open, so its state is on the row (specs/ui.md)",
      `the row beside "${SITE_NAMES[SITE]}" draws the same thing either way, ` +
        "once its number and name are set aside",
    );
  }
});
