// Refract — tracing/release-leaves-partial: releasing leaves the beam as
// drawn.
//
// specs/controls.md "Releasing": the release edge ends the trace and leaves
// the beam exactly as drawn, complete or not. A partial beam persists on the
// board, and a later press on either of its ends resumes it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNotNull,
  assertNull,
} from "../assert";
import { GEO_7X6 } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  pressCell,
  resetTo,
  traceCells,
  type Harness,
} from "../harness";

const A = { col: 0, row: 0 };
const B = { col: 1, row: 1 };
const C = { col: 2, row: 2 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("the release ends the trace, the partial beam persists, and a press on either end resumes it", async () => {
  await resetTo(h, 1);
  await loadBoard(h, GEO_7X6);

  // Two segments of a board that needs six: a partial beam. `trace` ends with
  // the release under test.
  traceCells(h, [A, B, C]);

  const released = h.snapshot();
  assertNull(released.tracing, "the release ends the trace");
  assertDeepEqual(
    released.beams.triangle?.cells,
    [A, B, C],
    "the beam is left exactly as drawn",
  );
  assertEqual(
    released.beams.triangle?.complete,
    false,
    "complete or not — this one persists incomplete",
  );

  // Evidence: the partial beam persisting after release.
  await h.advance(1);
  captureStill(h, "partial");

  // A later press on either of its ends resumes it.
  pressCell(h, C);
  const fromLive = h.snapshot();
  assertNotNull(fromLive.tracing, "a press on the live end resumes the trace");
  assertDeepEqual(fromLive.tracing?.live, C, "resumed from the pressed end");
  h.debug.pointerUp();

  pressCell(h, A);
  const fromFar = h.snapshot();
  assertNotNull(fromFar.tracing, "a press on the other end resumes it too");
  assertDeepEqual(fromFar.tracing?.live, A, "resumed from that end");
  h.debug.pointerUp();
});
