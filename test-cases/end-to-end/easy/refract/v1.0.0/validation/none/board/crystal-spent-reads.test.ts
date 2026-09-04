// board/crystal-spent-reads — a crystal's spent count reads from its form.
//
// specs/board.md: a crystal carries 1 to MAX_CHARGES (3) charges and a running
// spent count, and its form shows both, readable without counting slowly. How
// it shows the spent count is the build's — pips, numerals, a dimming form —
// so the reading is that the RENDER moves with the number: the same crystal's
// region changes once a traced beam enters it and its spent count goes 0 to 1
// (specs/beams.md: a beam entering a crystal spends one charge). The regions
// are compared point against point, and the item's figure — more than 50 of
// 441 at some paired sample — is met where the differing detail is drawn.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { CRYSTAL_END } from "../fixtures";
import {
  captureStill,
  center,
  createHarness,
  loadBoard,
  traceCells,
  type Harness,
  type RefractSnapshot,
} from "../harness";
import { DISTINCT_MIN, maxPairedDistance, sampleDisk } from "./sampling";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The one crystal's reported spent count on a posed CRYSTAL_END board. */
function crystalSpent(snapshot: RefractSnapshot): number | null {
  const crystal = snapshot.board.nodes.find((node) => node.kind === "crystal");
  return crystal === undefined ? null : crystal.spent;
}

it("changes the crystal's region when a traced beam spends its first charge", async () => {
  // T 1 T: the beam [T(0,0), crystal] enters the crystal and spends its one
  // charge (specs/beams.md), without completing the beam or solving the
  // board, so the change on screen is the crystal's alone to make.
  const board = await loadBoard(h, CRYSTAL_END);
  const at = center(board, { col: 1, row: 0 });

  assertEqual(
    crystalSpent(await h.snapshot()),
    0,
    "the posed crystal starts with nothing spent",
  );
  const before = await sampleDisk(h, at.x, at.y);

  await traceCells(h, [
    { col: 0, row: 0 },
    { col: 1, row: 0 },
  ]);
  assertEqual(
    crystalSpent(await h.snapshot()),
    1,
    "the traced entry spends one charge (specs/beams.md)",
  );

  await h.advance(1);
  await captureStill(h, "spent");
  const after = await sampleDisk(h, at.x, at.y);

  assertGreaterThan(
    maxPairedDistance(before, after),
    DISTINCT_MIN,
    "the crystal's region before against after the charge is spent",
  );
});
