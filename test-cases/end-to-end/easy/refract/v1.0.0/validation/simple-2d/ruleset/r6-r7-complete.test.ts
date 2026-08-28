// ruleset/r6-r7-complete — R6 Endpoints and R7 Coverage decide a complete
// beam, and neither is ever used to refuse a move.
//
// specs/beams.md: a channel's beam is complete when it runs between that
// channel's two emitters with exactly one segment meeting each (R6) and every
// lens of that channel carries exactly two of its segments (R7); the
// completion conditions "describe finished work, not legal moves" and are
// never used to refuse one. The board below carries two triangle lenses and a
// square channel that stays untouched, so the completed triangle beam never
// solves the board and the screen stays on `playing` for the capture.
//
//   - The SHORT route T(0,0)-t(1,1)-T(2,0) runs emitter to emitter with one
//     segment meeting each and threads t(1,1) twice — but leaves t(0,1)
//     unvisited, so `complete` reports false. That the route can be drawn at
//     all — its last move lands on the second emitter while a lens stands
//     unvisited — is the proof that R6 and R7 refuse nothing.
//   - The FULL route T(0,0)-t(0,1)-t(1,1)-T(2,0) threads every triangle lens
//     with exactly two segments, and `complete` reports true.
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

it("reports complete by endpoints and coverage, and never refuses a move by them", async () => {
  // The short route: emitter to emitter, one lens short of coverage.
  traceRoute(h, [
    [0, 0],
    [1, 1],
    [2, 0],
  ]);
  const short = h.snapshot();
  assertDeepEqual(
    short.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 1 },
      { col: 2, row: 0 },
    ],
    "the emitter-to-emitter route is drawn whole while a lens stands " +
      "unvisited — R6 and R7 are never used to refuse a move (specs/beams.md)",
  );
  assertEqual(
    short.beams.triangle?.complete,
    false,
    "R7: the route short one lens reports complete false — a lens of the " +
      "channel is left unvisited (specs/beams.md)",
  );

  // Start the board over and draw the covering route.
  h.debug.clear();
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
