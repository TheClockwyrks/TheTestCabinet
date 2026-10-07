// ruleset/completion-refuses-nothing — R6 and R7 are never used to refuse a
// move.
//
// specs/beams.md, Enforcement: the completion conditions "describe finished
// work, not legal moves" and are never used to refuse one. The route
// T(0,0)-t(1,1)-T(2,0) ends on the second triangle emitter while the lens
// t(0,1) stands unvisited, so the beam it draws can never be complete. Every
// move of it must still land, the closing move onto the second emitter
// included: a build that consults the completion conditions on a move refuses
// that closing move and fails here.
//
// The square channel stays untouched, so the board is never solved and the
// screen stays on `playing` for the capture.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  captureStill,
  createHarness,
  loadBoard,
  resetTo,
  traceRoute,
  type Harness,
} from "../harness";

/**
 * Two triangle lenses over an idle square channel: completable, never solved.
 * Written in specs/board.md notation; no shared fixture carries a channel
 * with two lenses beside an untouched second channel.
 */
const TWO_LENSES = `
T.T
tt.
S.S
`;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  await resetTo(h);
  await loadBoard(h, TWO_LENSES);
});

afterEach(() => {
  h?.dispose();
});

it("draws the lens-short route whole, its closing move included", async () => {
  traceRoute(h, [
    [0, 0],
    [1, 1],
    [2, 0],
  ]);
  const drawn = h.snapshot();
  assertDeepEqual(
    drawn.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 1 },
      { col: 2, row: 0 },
    ],
    "the emitter-to-emitter route is drawn whole while a lens stands " +
      "unvisited — R6 and R7 are never used to refuse a move (specs/beams.md)",
  );

  // Evidence: the lens-short route drawn whole.
  await h.advance(1);
  captureStill(h, "drawn");
});
