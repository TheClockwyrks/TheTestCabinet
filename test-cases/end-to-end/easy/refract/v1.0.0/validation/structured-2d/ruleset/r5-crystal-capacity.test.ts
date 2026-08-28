// Refract — ruleset/r5-crystal-capacity: a crystal is crossed once per charge.
//
// specs/beams.md R5: "A crystal carrying n charges is crossed at most n
// times." On CRYSTAL_TWICE the 2-charge crystal at (1,1) is crossed twice by
// the one triangle beam — in at (0,0), out to t(0,2), back in from t(1,2), out
// through t(1,0) — and the beam then steps on to t(2,1), so the attempt
// (2,1) -> (1,1) is the crossing after the n-th: refused. That approach uses a
// fresh, non-diagonal segment from a node that is not the crystal's neighbour
// in the beam, so the move is no retract and R5 is the one rule it breaks. Per
// the enforcement table the refusal leaves the beam unchanged and the trace
// live.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { CRYSTAL_TWICE } from "../fixtures";
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

it("the crossing after the n-th is refused", async () => {
  await resetTo(h, 1);
  await loadBoard(h, CRYSTAL_TWICE);

  // Two complete crossings of the 2-charge crystal, then a step to t(2,1).
  const route: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [1, 1],
    [0, 2],
    [1, 2],
    [1, 1],
    [1, 0],
    [2, 1],
  ];
  pressCell(h, { col: 0, row: 0 });
  for (const [col, row] of route.slice(1)) moveToCell(h, { col, row });
  const drawn = toCells(route);
  const posed = h.snapshot();
  assertDeepEqual(
    posed.beams.triangle?.cells,
    drawn,
    "both permitted crossings of the crystal are drawn",
  );
  const crystal = posed.board.nodes.find((node) => node.kind === "crystal");
  assertEqual(
    crystal?.spent,
    2,
    "both of the crystal's charges are spent by the two crossings",
  );

  // t(2,1) -> crystal (1,1): a third crossing of a 2-charge crystal, refused.
  moveToCell(h, { col: 1, row: 1 });
  const after = h.snapshot();
  assertDeepEqual(
    after.beams.triangle?.cells,
    drawn,
    "the crossing after the n-th is refused",
  );
  assertNotNull(after.tracing, "the refusal leaves the trace live");

  // Evidence: the crystal refusing a crossing past its charges.
  h.debug.pointerUp();
  await h.advance(1);
  captureStill(h, "refused");
});
