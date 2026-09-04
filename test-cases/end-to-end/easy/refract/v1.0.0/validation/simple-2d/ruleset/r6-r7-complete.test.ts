// ruleset/r6-r7-complete — a beam between its channel's two emitters, one
// segment meeting each, threading every lens of that channel with exactly two
// of its segments, reports complete true.
//
// specs/beams.md: a channel's beam is complete when it runs between that
// channel's two emitters with exactly one segment meeting each (R6) and every
// lens of that channel carries exactly two of its segments (R7). The board
// below carries two triangle lenses and a square channel that stays untouched,
// so the completed triangle beam never solves the board and the screen stays on
// `playing` for the capture.
//
// The emitter-as-pass-through variant of R6 cannot even be drawn — R5 caps an
// emitter at one segment (see ruleset/r5-emitter-capacity) — so completeness
// is asserted on the drawn set, as the manifest notes. `complete` is the
// snapshot's derived reading of R6 and R7 (specs/instrumentation.md).

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
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
  await resetTo(h, 1);
  await loadBoard(h, TWO_LENSES);
});

afterEach(() => {
  h?.dispose();
});

it("reports complete for the route that meets both emitters and every lens", async () => {
  traceRoute(h, [
    [0, 0],
    [0, 1],
    [1, 1],
    [2, 0],
  ]);
  const full = h.snapshot();
  assertDeepEqual(
    full.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 0, row: 1 },
      { col: 1, row: 1 },
      { col: 2, row: 0 },
    ],
    "the covering route is drawn whole",
  );
  assertEqual(
    full.beams.triangle?.complete,
    true,
    "R6 and R7: a beam between the channel's two emitters, one segment " +
      "meeting each, threading every lens of the channel with exactly two " +
      "segments, reports complete true (specs/beams.md)",
  );
  assertEqual(
    full.screen,
    "playing",
    "one complete beam does not solve while the square channel stands " +
      "empty (specs/beams.md R9), so play continues",
  );

  // Evidence: the beam reporting complete.
  await h.advance(1);
  captureStill(h, "complete");
});
