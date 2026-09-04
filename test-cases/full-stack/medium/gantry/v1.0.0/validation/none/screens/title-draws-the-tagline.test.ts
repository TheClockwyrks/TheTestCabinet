// screens/title-draws-the-tagline — the title screen draws `TAGLINE_TEXT`.
//
// `specs/ui.md` § The screens, Title: "The game opens on `title`, showing
// `TITLE_TEXT` (`GANTRY`), `TAGLINE_TEXT` (`RIG THE CRANE. RUN THE TAPE.`), and
// the menu `TITLE_ITEMS` (`SITES`, `HOW TO PLAY`), with `menuIndex` `0` on
// arriving." The copy is the case's; how it is set is the build's.
//
// THAT SENTENCE NAMES FOUR PIECES OF COPY, and each is a check of its own: a
// title screen that draws its title and forgets its tagline has to grade above
// one that draws neither, and one point over the four could not tell them
// apart. The order the two menu entries stand in is a fifth,
// `screens/title-draws-its-menu-entries-in-order`. This one decides
// `TAGLINE_TEXT` alone.
//
// WHAT IS READ IS THE FRAME'S OWN TEXT, not the snapshot: the snapshot says
// which screen is showing and says nothing about what was drawn on it, and a
// title screen that draws none of its copy is exactly the miss this item is
// about. The reading is the operations the build issued against its 2D context
// on the last frame, which the harness's injected recorder holds.
//
// MATCHING IGNORES HOW THE COPY IS BROKEN UP AND SPACED. A build is free to
// draw a menu entry with a selection marker beside it, to letter-space a title
// into one call per glyph, or to set the tagline over two lines, so a run is
// matched against the frame's whole text in reading order with whitespace
// removed rather than against one `fillText` argument. What is asserted is that
// the copy was drawn, and never a position, a font, or a colour.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue, fail } from "../assert";
import { TAGLINE_TEXT } from "../constants";
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
    } else if (op.method === "restore") {
      m = stack.pop() ?? IDENTITY;
    } else if (op.method === "resetTransform") {
      m = IDENTITY;
    } else if (op.method === "setTransform" && n.length >= 6) {
      m = [n[0], n[1], n[2], n[3], n[4], n[5]];
    } else if (op.method === "transform" && n.length >= 6) {
      m = mul(m, [n[0], n[1], n[2], n[3], n[4], n[5]]);
    } else if (op.method === "translate" && n.length >= 2) {
      m = mul(m, [1, 0, 0, 1, n[0], n[1]]);
    } else if (op.method === "scale" && n.length >= 2) {
      m = mul(m, [n[0], 0, 0, n[1], 0, 0]);
    } else if (op.method === "rotate" && n.length >= 1) {
      m = mul(m, [
        Math.cos(n[0]),
        Math.sin(n[0]),
        -Math.sin(n[0]),
        Math.cos(n[0]),
        0,
        0,
      ]);
    } else if (
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
  return (await harness.page.evaluate(
    (global) =>
      (window as unknown as Record<string, { last(): unknown[] }>)[
        global
      ]!.last(),
    RECORDER,
  )) as RecordedOp[];
}

/* -------------------------------------------------------------------------- */

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws TAGLINE_TEXT", async () => {
  await h.debug.setScreen("title");
  await h.debug.setMenuIndex(0);
  await h.advance(1);

  const order = readingOrder(textDraws(await frameOps(h)));
  await h.capture("tagline", "The title screen's tagline");

  assertTrue(
    order.length > 0,
    "the title screen to draw text at all (specs/ui.md)",
  );

  if (findText(order, TAGLINE_TEXT) === null) {
    fail(
      `the title screen to draw "${TAGLINE_TEXT}" (specs/ui.md)`,
      `it drew ${JSON.stringify(order.map((d) => d.text))}`,
    );
  }
});
