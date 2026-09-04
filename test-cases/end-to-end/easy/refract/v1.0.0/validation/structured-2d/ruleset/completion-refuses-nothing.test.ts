// Refract — ruleset/completion-refuses-nothing: R6 and R7 refuse no move.
//
// specs/beams.md, Enforcement: R6, R7 and R8 are "never used to refuse a
// move" — they are the conditions R9 reads, and "a partial beam therefore
// breaks no rule". On the private board below the straight route
// T(0,0)-t(1,0)-T(2,0) ends on the far emitter while the lens t(1,1) stands
// unvisited, so the beam it draws can never be complete. Every move of it must
// still land, the closing move onto the second emitter included: a build that
// consults the completion conditions on a move refuses that closing move and
// fails here.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  captureStill,
  createHarness,
  loadBoard,
  resetTo,
  toCells,
  traceCells,
  type Harness,
} from "../harness";

/**
 * Private fixture — two routes between the emitters. The straight route
 * T(0,0)-t(1,0)-T(2,0) misses the lens t(1,1); the detour
 * T(0,0)-t(1,1)-t(1,0)-T(2,0) threads both lenses with exactly two segments
 * each. The crystal at (0,2) is never crossed, so its charges stay unspent and
 * the board stays unsolved either way.
 */
const TWO_ROUTES = `
TtT
.t.
3..
`;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("the lens-short route is drawn whole, its closing move included", async () => {
  await resetTo(h, 1);
  await loadBoard(h, TWO_ROUTES);

  const short: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [1, 0],
    [2, 0],
  ];
  traceCells(h, toCells(short));
  assertDeepEqual(
    h.snapshot().beams.triangle?.cells,
    toCells(short),
    "the route between the emitters is drawn whole while a lens stands " +
      "unvisited — the completion conditions refuse nothing",
  );

  // Evidence: the lens-short route drawn whole.
  await h.advance(1);
  captureStill(h, "drawn");
});
