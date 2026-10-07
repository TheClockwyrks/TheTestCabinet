// ruleset/solving-ends-the-trace — a trace ends the moment the board is
// solved: the beams stay exactly as drawn, the release that follows begins
// nothing and changes nothing, and a further press changes nothing, so a
// solved board cannot be taken apart by retracting (specs/controls.md,
// Releasing; specs/beams.md R9).
//
// THE POSE. `MINIMAL_2X1` ("TT"): one segment joins the two emitters,
// completes the beam (no lenses, one segment meeting each emitter) and solves
// the board — the smallest board on which the solving move and the trace's
// end can be read on the same call.
//
// The comparisons are over the GAME-FACING fields — beams, tracing, solved,
// screen — rather than the whole snapshot: `pointer` deliberately mirrors the
// live pointer every update (specs/instrumentation.md), so it moves with the
// very press this check makes.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import { MINIMAL_2X1 } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  type Harness,
} from "../harness";
import { moveOver, pressAt } from "./drive";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("the solving move ends the trace, and neither the release nor a further press changes the beams", async () => {
  const board = await loadBoard(h, MINIMAL_2X1);

  // The one move that solves the board, with the trace held down.
  await pressAt(h, board, { col: 0, row: 0 });
  await moveOver(h, board, { col: 1, row: 0 });
  const solving = await h.snapshot();

  // The release that follows begins nothing and changes nothing.
  await h.debug.pointerUp();
  const released = await h.snapshot();

  // A further press on the beam's end — the grab that would resume a live
  // board — changes nothing on a solved one.
  await pressAt(h, board, { col: 1, row: 0 });
  const pressed = await h.snapshot();
  await h.debug.pointerUp();

  await h.advance(1);
  await captureStill(h, "held");

  assertEqual(solving.solved, true, "the move solves the board");
  assertNull(solving.tracing, "the trace is null on the frame the move solves");
  assertDeepEqual(
    solving.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ],
    "the beam stands exactly as drawn on the solving move",
  );

  assertDeepEqual(
    released.beams,
    solving.beams,
    "the release that follows leaves the beams exactly as drawn",
  );
  assertNull(released.tracing, "the release begins nothing");

  assertDeepEqual(
    pressed.beams,
    solving.beams,
    "a further press leaves the beams exactly as drawn",
  );
  assertNull(pressed.tracing, "a further press begins no trace");
  assertEqual(pressed.solved, true, "the board stays solved");
  assertEqual(
    pressed.screen,
    released.screen,
    "a further press moves no screen",
  );
});
