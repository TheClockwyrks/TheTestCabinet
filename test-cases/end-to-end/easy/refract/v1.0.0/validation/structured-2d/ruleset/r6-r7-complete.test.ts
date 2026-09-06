// Refract — ruleset/r6-r7-complete: a beam meeting R6 and R7 reports complete.
//
// specs/beams.md R6: a beam is complete only when it "runs between that
// channel's two emitters, with exactly one segment meeting each"; R7: only
// when "every lens of that channel carries exactly two of its segments". The
// private board below carries an untouched 3-charge crystal, so the complete
// beam never solves the board and the reading stays on `playing`. The route
// T(0,0)-t(1,1)-t(1,0)-T(2,0) threads both lenses twice-each and meets each
// emitter once, and reports complete true. The emitter-as-pass-through variant
// cannot even be drawn (R5), so completeness via endpoints is asserted on the
// drawn set.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
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

it("the route threading every lens twice-each reports complete true", async () => {
  await resetTo(h);
  await loadBoard(h, TWO_ROUTES);

  // T(0,0)-t(1,1)-t(1,0)-T(2,0): one segment meets each emitter, and each of
  // the two lenses carries exactly two of the beam's segments.
  const full: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [1, 1],
    [1, 0],
    [2, 0],
  ];
  traceCells(h, toCells(full));
  const snap = h.snapshot();
  assertDeepEqual(
    snap.beams.triangle?.cells,
    toCells(full),
    "the full route is drawn whole",
  );
  assertEqual(
    snap.beams.triangle?.complete,
    true,
    "the beam meeting R6 and R7 reports complete true",
  );

  // Complete is not solved: the crystal's charges are unspent, so R9 fails
  // and the game stays on playing.
  assertEqual(snap.solved, false, "the untouched crystal keeps R9 false");
  assertEqual(snap.screen, "playing", "completion alone leaves playing alone");

  // Evidence: the beam reporting complete.
  await h.advance(1);
  captureStill(h, "complete");
});
