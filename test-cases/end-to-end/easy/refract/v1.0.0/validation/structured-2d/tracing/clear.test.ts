// Refract — tracing/clear: the clear action empties every beam.
//
// specs/controls.md "Clearing": the `clear` action empties every beam on the
// board at once and leaves the board's nodes untouched, so a player can start
// a board over without leaving it. "Actions and bindings" fixes the binding:
// `clear` is bound to KeyR — so the key itself is tapped here, through the
// engine's real input path, and both the binding and the effect are what pass.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { R2_FOREIGN } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  resetTo,
  traceCells,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("KeyR empties every beam at once, leaves the nodes untouched, and stays on the playing screen", async () => {
  await resetTo(h);
  await loadBoard(h, R2_FOREIGN);

  // Beams drawn on two channels, both partial.
  traceCells(h, [
    { col: 0, row: 0 },
    { col: 1, row: 0 },
  ]);
  traceCells(h, [
    { col: 0, row: 2 },
    { col: 1, row: 1 },
  ]);
  const before = h.snapshot();
  assertDeepEqual(
    before.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ],
    "the triangle beam is drawn before the clear",
  );
  assertDeepEqual(
    before.beams.square?.cells,
    [
      { col: 0, row: 2 },
      { col: 1, row: 1 },
    ],
    "the square beam is drawn before the clear",
  );

  // The clear action, by its specified binding: KeyR, pressed and released,
  // with the one frame that delivers the edge.
  await h.tap("KeyR");

  const after = h.snapshot();
  assertDeepEqual(
    after.beams.triangle?.cells,
    [],
    "the clear action empties the triangle beam",
  );
  assertDeepEqual(
    after.beams.square?.cells,
    [],
    "the clear action empties the square beam at the same stroke",
  );
  assertDeepEqual(after.board, before.board, "the board's nodes are untouched");
  assertEqual(
    after.screen,
    "playing",
    "the player stays on the playing screen",
  );

  // Evidence: the board cleared of its beams (the tap's frame rendered it).
  captureStill(h, "cleared");
});
