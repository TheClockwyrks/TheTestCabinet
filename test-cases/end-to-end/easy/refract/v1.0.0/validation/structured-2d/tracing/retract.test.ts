// Refract — tracing/retract: backing up removes the last segment.
//
// specs/controls.md "Retracting": the pointer moving within NODE_HIT_R (44)
// of the node immediately behind the live end removes the last segment, and
// that node becomes the live end. A beam is unwound one segment at a time by
// backing the pointer along it without releasing.
//
// The beam is three segments of GEO_7X6's lens diagonal, drawn held and then
// backed out node by node to its first cell, all under one press. The
// declared output is a REPLAY of the unwinding.
//
// specs/controls.md phrases this requirement about the pointer a PLAYER holds,
// so the drag is driven through the engine's own pointer input rather than
// through the debug surface's pointer operations. Those resolve between frames
// (specs/instrumentation.md), and no rule says a posed press is still held
// after a frame has advanced — driving them across the `advance` calls this
// replay needs would grade that unstated behavior instead of this one. Each
// player helper raises the real sample and then runs the one frame that
// delivers it, and the replay's own frames follow.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNotNull } from "../assert";
import { GEO_7X6 } from "../fixtures";
import {
  captureReplay,
  createHarness,
  loadBoard,
  playerMoveTo,
  playerPress,
  playerRelease,
  resetTo,
  type Harness,
} from "../harness";

const A = { col: 0, row: 0 };
const B = { col: 1, row: 1 };
const C = { col: 2, row: 2 };
const D = { col: 3, row: 3 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moving onto the node behind the live end removes the last segment, repeated to unwind the beam without releasing", async () => {
  await resetTo(h, 1);
  await loadBoard(h, GEO_7X6);

  // Draw A -> B -> C -> D and keep the press held.
  await playerPress(h, A);
  await playerMoveTo(h, B);
  await playerMoveTo(h, C);
  await playerMoveTo(h, D);
  assertDeepEqual(
    h.snapshot().beams.triangle?.cells,
    [A, B, C, D],
    "the held trace drew the beam to unwind",
  );

  await captureReplay(h, "retract", async () => {
    await h.advance(6);

    await playerMoveTo(h, C);
    let snap = h.snapshot();
    assertDeepEqual(
      snap.beams.triangle?.cells,
      [A, B, C],
      "backing onto the node behind the live end removes the last segment",
    );
    assertDeepEqual(snap.tracing?.live, C, "that node becomes the live end");
    await h.advance(6);

    await playerMoveTo(h, B);
    snap = h.snapshot();
    assertDeepEqual(
      snap.beams.triangle?.cells,
      [A, B],
      "each step back removes exactly one more segment",
    );
    assertDeepEqual(snap.tracing?.live, B, "the live end steps back with it");
    await h.advance(6);

    await playerMoveTo(h, A);
    snap = h.snapshot();
    assertDeepEqual(
      snap.beams.triangle?.cells,
      [A],
      "the beam is unwound to its first cell",
    );
    assertDeepEqual(snap.tracing?.live, A, "the first cell is the live end");
    assertNotNull(snap.tracing, "all without releasing: the trace stays live");
    await h.advance(6);
  });

  await playerRelease(h, A);
});
