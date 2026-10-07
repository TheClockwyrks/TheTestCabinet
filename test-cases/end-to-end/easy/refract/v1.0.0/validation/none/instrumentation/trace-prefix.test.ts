// Refract — instrumentation/trace-prefix: a route whose hops the limits refuse
// part way through leaves the beam ending at the last segment they permitted,
// and the game does not throw.
//
// A route is drawn through the surface's three pointer operations, which feed
// the same input path a player's pointer feeds, so it is subject to every limit
// a hand-drawn trace is — and `specs/instrumentation.md` states exactly what a
// refused hop leaves behind: "a move the limits refuse changes nothing and
// leaves the trace live", and "the release ends the trace and leaves the beam
// as drawn". The failure modes this catches are a build that throws on the
// refused hop (the whole call is awaited; a throw inside it fails this check
// with the build's own error), one that abandons the permitted prefix, and one
// that applies the refused segment anyway.
//
// The route's third hop lands on another channel's lens, a move R2 refuses
// (`specs/beams.md`), so exactly the first two cells survive. That the game is
// still running afterwards is proven by playing on: the square channel draws a
// segment of its own through the same surface, and the build accepts it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNull } from "../assert";
import { R2_FOREIGN } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  traceCells,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("a refused third hop leaves exactly the first two cells, and play goes on", async () => {
  // R2_FOREIGN: triangle across the top, a square lens s at (1, 1). The list's
  // first hop presses T(0, 0), the second draws to t(1, 0) — permitted — and
  // the third asks for s(1, 1), another channel's lens, which R2 refuses.
  await loadBoard(h, R2_FOREIGN);

  await traceCells(h, [
    { col: 0, row: 0 },
    { col: 1, row: 0 },
    { col: 1, row: 1 },
  ]);

  await h.advance(1);
  await captureStill(h, "prefix");

  const after = await h.snapshot();
  assertDeepEqual(
    after.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ],
    "the beam ends at the last segment the limits permitted",
  );
  assertNull(after.tracing, "the trace's release still lands");

  // The game did not throw: the surface still answers, and the same pointer
  // path accepts a fresh, legal move — square from its own emitter to its own
  // lens, the diagonal S(0, 2) to s(1, 1).
  await traceCells(h, [
    { col: 0, row: 2 },
    { col: 1, row: 1 },
  ]);
  const alive = await h.snapshot();
  assertDeepEqual(
    alive.beams.square?.cells,
    [
      { col: 0, row: 2 },
      { col: 1, row: 1 },
    ],
    "the game plays on after the refused list",
  );
  assertDeepEqual(
    alive.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ],
    "the kept prefix is untouched by the later trace",
  );
});
