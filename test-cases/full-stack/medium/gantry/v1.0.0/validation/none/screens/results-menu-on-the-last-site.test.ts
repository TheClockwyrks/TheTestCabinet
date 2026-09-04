// screens/results-menu-on-the-last-site — the last site's results menu leaves
// NEXT SITE out.
//
// `specs/ui.md` § The screens, Results: "`results` shows `CLEARED_TEXT` (`SITE
// CLEARED`), the run's cost and time beside the site's par cost and par time
// (`specs/sites.md`), and the menu `RESULTS_ITEMS` (`NEXT SITE`, `REPLAY`, `SITE
// SELECT`), with `menuIndex` `0` on arriving. On the last site `NEXT SITE` is
// left out and the menu is the other two entries in the same order."
//
// THE LAST SITE IS INDEX `SITE_COUNT - 1`, Heavy Haul, and `openSite` reaches it
// "locked or not" (`specs/instrumentation.md`) — which is what lets this item be
// decided without playing five sites to get there. The clear itself is posed with
// `setCleared`, the precondition a clear leaves, because `results` is where "a
// cleared run moves to" and running a tape to a real clear would grade the
// statics and the rigging on the way to a question about one menu.
//
// WHAT IS READ IS THE FRAME'S OWN TEXT. The snapshot reports the highlighted
// entry and never the entries, so the menu a build actually offers is only
// visible in what it drew. Matching joins the frame's runs in reading order with
// the spaces removed, so an entry drawn with a selection marker, letter-spaced or
// split across calls reads the same as one drawn whole — and `NEXT SITE` is
// looked for that way too, so a build that draws it dimmed or padded is still
// caught leaving it in.
//
// BOTH HALVES OF THE SENTENCE ARE ONE REQUIREMENT: the menu is "the other two
// entries in the same order", which is not decided by their presence alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue, fail } from "../assert";
import { RESULTS_ITEMS, SITE_COUNT } from "../constants";
import { createHarness, openSite, type Harness } from "../harness";
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

/* -------------------------------------------------------------------------- */

/** The last site: Heavy Haul, at index `SITE_COUNT - 1`. */
const LAST = SITE_COUNT - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("offers REPLAY then SITE SELECT and no NEXT SITE on the last site", async () => {
  await openSite(h, LAST);
  await h.debug.setCleared(LAST, true);
  await h.debug.setScreen("results");
  await h.debug.setMenuIndex(0);
  await h.advance(1);

  const posed = await h.snapshot();
  assertEqual(posed.screen, "results", "the screen the menu is read off");
  assertEqual(posed.siteIndex, LAST, "the site the results are showing");

  const order = readingOrder(textDraws(await frameOps(h)));
  await h.capture("state", "The results menu on the last site");

  assertTrue(
    order.length > 0,
    "the results screen to draw text at all (specs/ui.md)",
  );
  const drawn = JSON.stringify(order.map((draw) => draw.text));

  if (findText(order, RESULTS_ITEMS[0]) !== null) {
    fail(
      `the last site's results menu to leave "${RESULTS_ITEMS[0]}" out ` +
        "(specs/ui.md)",
      `it drew ${drawn}`,
    );
  }

  const replay = findText(order, RESULTS_ITEMS[1]);
  const select = findText(order, RESULTS_ITEMS[2]);
  if (replay === null || select === null) {
    fail(
      `the last site's results menu to be "${RESULTS_ITEMS[1]}" and ` +
        `"${RESULTS_ITEMS[2]}" (specs/ui.md)`,
      `it drew ${drawn}`,
    );
  }
  assertTrue(
    replay < select,
    `"${RESULTS_ITEMS[1]}" to be drawn before "${RESULTS_ITEMS[2]}", the ` +
      "order RESULTS_ITEMS lists them in (specs/ui.md)",
  );
});
