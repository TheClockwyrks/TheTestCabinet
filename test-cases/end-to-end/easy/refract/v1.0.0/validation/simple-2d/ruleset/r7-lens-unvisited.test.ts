// ruleset/r7-lens-unvisited — the same route short one lens reports complete
// false.
//
// specs/beams.md R7: a channel's beam is complete only when every lens of that
// channel carries exactly two of its segments, and no lens of a channel present
// is left unvisited. The route T(0,0)-t(1,1)-T(2,0) runs emitter to emitter
// with one segment meeting each — R6 holds — and threads t(1,1) twice, but it
// leaves t(0,1) unvisited, so `complete` reports false. The square channel
// stays untouched, so the board is never solved and the screen stays on
// `playing` for the capture.
//
// `complete` is the snapshot's derived reading of R6 and R7
// (specs/instrumentation.md).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
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

it("reports complete false for the route that leaves a lens unvisited", async () => {
  traceRoute(h, [
    [0, 0],
    [1, 1],
    [2, 0],
  ]);
  const short = h.snapshot();
  assertEqual(
    short.beams.triangle?.complete,
    false,
    "R7: the route short one lens reports complete false — a lens of the " +
      "channel is left unvisited (specs/beams.md)",
  );
  assertEqual(
    short.screen,
    "playing",
    "an incomplete beam solves nothing, so play continues",
  );

  // Evidence: the route short one lens, reporting incomplete.
  await h.advance(1);
  captureStill(h, "incomplete");
});
