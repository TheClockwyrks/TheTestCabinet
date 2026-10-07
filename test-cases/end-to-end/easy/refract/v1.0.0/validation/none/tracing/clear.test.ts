// Refract — tracing/clear: the clear action empties every beam.
//
// `specs/controls.md` "Clearing": the `clear` action empties every beam on the
// board at once and leaves the board's nodes untouched, so a player can start
// a board over without leaving it — and "Actions and bindings" pins `clear` to
// `KeyR`, the one binding the specification fixes. The key is pressed through
// Chromium's own input pipeline (down, one delivered frame, up), never through
// the surface's `clear` operation: the subject is the action a player fires.
// Beams are drawn on BOTH channels first, so "every beam ... at once" is a
// real claim, and the after-state is read for all three clauses: both beams
// empty, the nodes byte-identical, the screen still `playing`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { R2_FOREIGN } from "../fixtures";
import {
  captureStill,
  createHarness,
  fireAction,
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

it("empties both beams at once, keeps the nodes, stays on playing", async () => {
  await loadBoard(h, R2_FOREIGN);
  await traceCells(h, [
    { col: 0, row: 0 },
    { col: 1, row: 0 },
  ]);
  await traceCells(h, [
    { col: 0, row: 2 },
    { col: 1, row: 1 },
  ]);

  const before = await h.snapshot();
  assertEqual(
    (before.beams.triangle?.cells ?? []).length > 0 &&
      (before.beams.square?.cells ?? []).length > 0,
    true,
    "beams are drawn on two channels before the clear",
  );

  // The clear action, on its fixed KeyR binding.
  await fireAction(h, "clear");
  await captureStill(h, "cleared");

  const after = await h.snapshot();
  assertDeepEqual(
    after.beams.triangle?.cells,
    [],
    "the triangle beam is emptied",
  );
  assertDeepEqual(after.beams.square?.cells, [], "the square beam is emptied");
  assertDeepEqual(
    after.board,
    before.board,
    "the board's nodes are left untouched",
  );
  assertEqual(after.screen, "playing", "the player stays on the board");
});
