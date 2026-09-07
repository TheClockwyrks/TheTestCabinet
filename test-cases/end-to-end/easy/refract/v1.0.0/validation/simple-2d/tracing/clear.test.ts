// Refract — tracing/clear: the clear action empties every beam.
//
// specs/controls.md "Clearing" and "Actions and bindings": the `clear` action
// — bound to `KeyR` — empties every beam on the board at once and leaves the
// board's nodes untouched, so a player can start a board over without leaving
// it; it is read on the `playing` screen.
//
// The key is dispatched as a REAL `KeyR` tap at the target the engine listens
// on, not through the surface's `clear` pose, because the binding is part of
// the claim. The board is R2_FOREIGN (fixtures.ts) with a partial beam drawn
// on each of its two channels, so "every beam ... at once" is two beams, not
// one.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { R2_FOREIGN } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  resetTo,
  traceRoute,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("empties every beam at once on KeyR, leaving the nodes and the screen alone", async () => {
  await resetTo(h);
  await loadBoard(h, R2_FOREIGN);

  // A partial beam on each channel.
  traceRoute(h, [
    [0, 0],
    [1, 0],
  ]);
  traceRoute(h, [
    [0, 2],
    [1, 1],
  ]);
  const before = h.snapshot();
  assertEqual(
    before.beams.triangle?.cells.length,
    2,
    "the triangle beam is drawn before the clear",
  );
  assertEqual(
    before.beams.square?.cells.length,
    2,
    "the square beam is drawn before the clear",
  );

  // The real key: specs/controls.md binds `clear` to KeyR.
  await h.tap("KeyR");
  captureStill(h, "cleared");

  const after = h.snapshot();
  assertEqual(
    after.beams.triangle?.cells.length,
    0,
    "the clear action empties the triangle beam (specs/controls.md, " +
      "Clearing; clear is bound to KeyR)",
  );
  assertEqual(
    after.beams.square?.cells.length,
    0,
    "the clear action empties the square beam in the same stroke",
  );
  assertDeepEqual(
    after.board.nodes,
    before.board.nodes,
    "the board's nodes are left untouched",
  );
  assertEqual(
    after.screen,
    "playing",
    "the player is left on the playing screen, to start the board over",
  );
});
