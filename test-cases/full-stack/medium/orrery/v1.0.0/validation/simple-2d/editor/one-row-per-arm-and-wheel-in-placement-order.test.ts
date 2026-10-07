// editor/one-row-per-arm-and-wheel-in-placement-order — the panel's rows are the
// arms and wheels of `editor.parts`, in that list's order.
//
// THE RULE. "The panel shows one row per arm and wheel, in placement order"
// (`specs/editor.md`, The tape panel), and "Visible row `v`, from `0` to `4` ...
// shows the arm at index `firstRow + v` in placement order", with `firstRow` `0`
// "with no cursor". Placement order is the order of `editor.parts`:
// `specs/instrumentation.md` reports that list as "placement order; the tape
// panel's row order", and `specs/formats.md` agrees — "The order of `parts` is the
// machine's placement order, which fixes the tape panel's row order."
//
// HOW A ROW IS READ. By pressing its label, which is the observable the same file
// gives: "A press inside a row's label points [the cursor] at that row, column
// `0`", and "a press in the panel that lands on no row or cell leaves the cursor
// as it is". So a press in visible row `v`'s label with the cursor cleared names
// the `v`-th row's part, and a press in a row the panel does not have leaves the
// cleared cursor cleared.
//
// THE CONFIGURATION. `BARE` opened in the editor, the machine cleared, and three
// parts that carry rows placed one at a time through the surface, in an order that
// matches no geometry: an arm on `(3, 0)` FIRST, then a wheel on `(-3, 0)`, then an
// arm on `(0, 0)`. Reading the field left to right, or by hex coordinate, would
// give a different order in each case, so a build that sorted its rows any other
// way than by placement is caught here. Nothing else is on the field, so the rows
// are exactly these three.
//
// The cursor is cleared before every press, both so `firstRow` is `0` — the panel
// is showing rows `0`, `1`, `2` — and so the cursor read after a press is that
// press's own doing rather than a value it inherited.
//
// THE VERDICT. Visible row `k` points the cursor at the `k`-th entry of
// `editor.parts`, for each of the three, and visible row `3` points at nothing:
// there are three rows, one per part, and no fourth.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import { regionCenter, tapeLabel } from "../field";
import { BARE, EAST, ORIGIN, WEST } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  partIds,
  placePart,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Clear the cursor, press visible row `v`'s label, and answer where the cursor landed. */
async function pressLabel(
  v: number,
): Promise<{ part: number; col: number } | null> {
  await h.debug.setCursor(null, 0);
  await pressAt(h, regionCenter(tapeLabel(v)));
  await releasePointer(h);
  return (await h.snapshot()).editor.cursor;
}

it("points visible row k at the k-th arm or wheel in placement order", async () => {
  await openChallengeDocument(h, BARE);
  const placed = [
    await placePart(h, "arm", EAST),
    await placePart(h, "wheel", WEST),
    await placePart(h, "arm", ORIGIN),
  ];

  await h.debug.setCursor(null, 0);
  await h.advance(1);
  await captureStill(h, "rows");

  assertDeepEqual(
    await partIds(h),
    placed,
    "editor.parts holds the three parts in the order they were placed, which is the row order",
  );

  for (const [k, part] of placed.entries()) {
    assertEqual(
      (await pressLabel(k))?.part,
      part,
      `visible row ${k} is the row of the ${k === 0 ? "first" : k === 1 ? "second" : "third"} arm or wheel placed`,
    );
  }

  assertNull(
    await pressLabel(placed.length),
    "the panel shows one row per arm and wheel and no more, so a press in visible row 3's label lands on no row",
  );
});
