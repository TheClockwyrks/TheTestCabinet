// The two placements of one merged run, and the recorded transform that places
// a draw an operation walk could not.
//
// `drawnTextRuns` and `reanchoredTextRuns` coalesce the same draws into the same
// runs with the same extents. They answer differently about where a merged run's
// `x` sits, and they agree exactly on a run of one draw and on any `start`-
// aligned run — which is why the disagreement went unnoticed while the two lived
// in separate files. These checks pin both answers, so folding them fails here
// rather than silently moving every centred merged run in one vocabulary.

import { expect, it } from "vitest";
import type { DrawCall } from "../src/draw-calls";
import type { Matrix } from "../src/matrix";
import {
  drawnTextRuns,
  drawnTextLines,
  reanchoredTextRuns,
  textDraws,
} from "../src/text";

/** One measured text call, as an engine harness's recorder writes it. */
function glyph(
  text: string,
  x: number,
  width: number,
  textAlign = "start",
  transform: Matrix = [1, 0, 0, 1, 0, 0],
): DrawCall {
  return {
    kind: "call",
    method: "fillText",
    args: [text, x, 100],
    text: { width, textAlign, transform },
  };
}

/** `HEAD`, letter-spaced a glyph per call, each 10 wide and 10 apart. */
const SPACED: DrawCall[] = [
  glyph("H", 0, 10, "center"),
  glyph("E", 10, 10, "center"),
  glyph("A", 20, 10, "center"),
  glyph("D", 30, 10, "center"),
];

it("both readings merge the same draws into the same run", () => {
  expect(drawnTextLines(SPACED)).toEqual(["HEAD"]);
  const kept = drawnTextRuns(SPACED);
  const moved = reanchoredTextRuns(SPACED);
  expect(kept).toHaveLength(1);
  expect(moved).toHaveLength(1);
  expect(moved[0]?.left).toBe(kept[0]?.left);
  expect(moved[0]?.right).toBe(kept[0]?.right);
  expect(moved[0]?.text).toBe("HEAD");
});

it("one keeps the FIRST DRAW's anchor and the other re-anchors the whole run", () => {
  const kept = drawnTextRuns(SPACED)[0];
  const moved = reanchoredTextRuns(SPACED)[0];
  // A centred first glyph is anchored at its own centre...
  expect(kept?.x).toBe(0);
  // ...and the merged run is centred on the whole of what it spells.
  expect(moved?.left).toBe(-5);
  expect(moved?.right).toBe(35);
  expect(moved?.x).toBe(15);
});

it("the two agree exactly on a run of one draw", () => {
  const one = [glyph("SOLO", 40, 20, "center")];
  expect(reanchoredTextRuns(one)).toEqual(drawnTextRuns(one));
  expect(reanchoredTextRuns(one)[0]).toMatchObject(textDraws(one)[0] as object);
});

it("the two agree on any start-aligned run, merged or not", () => {
  const left: DrawCall[] = [glyph("A", 0, 10), glyph("B", 10, 10)];
  expect(reanchoredTextRuns(left)[0]?.x).toBe(drawnTextRuns(left)[0]?.x);
});

it("a right-aligned merged run re-anchors to its own right edge", () => {
  const right: DrawCall[] = [
    glyph("9", 0, 10, "right"),
    glyph("8", 10, 10, "right"),
  ];
  const moved = reanchoredTextRuns(right)[0];
  expect(moved?.left).toBe(-10);
  expect(moved?.right).toBe(10);
  expect(moved?.x).toBe(10);
});

it("a run carries the alignment of its first draw and nothing later", () => {
  const mixed: DrawCall[] = [glyph("A", 0, 10), glyph("B", 10, 10, "center")];
  expect(drawnTextRuns(mixed)[0]?.align).toBe("start");
});

it("a recorded transform places a draw the operation walk could not see", () => {
  // A `setTransform` the engine's own fit issued, with no `save`/`restore` and
  // no scale/translate the walk could have followed.
  const placed = [glyph("X", 5, 4, "start", [2, 0, 0, 2, 30, 40])];
  const [draw] = textDraws(placed);
  expect(draw?.x).toBe(40);
  expect(draw?.y).toBe(240);
  // And the width takes the same horizontal scale as the anchor.
  expect((draw?.right as number) - (draw?.left as number)).toBe(8);
});

it("without a recorded transform the walk still places the draw", () => {
  const walked: DrawCall[] = [
    { kind: "call", method: "translate", args: [30, 40] },
    {
      kind: "call",
      method: "fillText",
      args: ["X", 5, 5],
      text: { width: 4, textAlign: "start" },
    },
  ];
  const [draw] = textDraws(walked);
  expect(draw?.x).toBe(35);
  expect(draw?.y).toBe(45);
});
