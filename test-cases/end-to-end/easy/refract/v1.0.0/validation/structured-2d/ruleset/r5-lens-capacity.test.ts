// Refract — ruleset/r5-lens-capacity: a lens carries two segments.
//
// specs/beams.md R5: "A lens carries at most two segments of its own
// channel." On R5_LENS the route T(0,0)-t(1,1)-t(0,1)-t(1,2) fills the lens
// t(1,1) with its two segments, and the extension t(1,2) -> t(1,1) would be a
// third segment of that channel onto it: a fresh, non-diagonal segment whose
// endpoints leave every other rule satisfied, so R5 alone refuses it. Per the
// enforcement table the refusal leaves the beam unchanged and the trace live.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNotNull } from "../assert";
import { R5_LENS } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  moveToCell,
  pressCell,
  resetTo,
  toCells,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("a third segment of the channel onto a full lens is refused", async () => {
  await resetTo(h, 1);
  await loadBoard(h, R5_LENS);

  // T(0,0)-t(1,1)-t(0,1)-t(1,2): the lens t(1,1) now carries two segments.
  const route: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [1, 1],
    [0, 1],
    [1, 2],
  ];
  pressCell(h, { col: 0, row: 0 });
  for (const [col, row] of route.slice(1)) moveToCell(h, { col, row });
  const drawn = toCells(route);
  assertDeepEqual(
    h.snapshot().beams.triangle?.cells,
    drawn,
    "the route filling the lens is drawn whole",
  );

  // t(1,2) -> t(1,1) would be the lens's third segment: refused.
  moveToCell(h, { col: 1, row: 1 });
  const after = h.snapshot();
  assertDeepEqual(
    after.beams.triangle?.cells,
    drawn,
    "the full lens refuses a third segment",
  );
  assertNotNull(after.tracing, "the refusal leaves the trace live");

  // Evidence: the lens refusing a third segment.
  h.debug.pointerUp();
  await h.advance(1);
  captureStill(h, "refused");
});
