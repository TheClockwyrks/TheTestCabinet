// Refract — tracing/retract: backing up removes the last segment.
//
// specs/controls.md "Retracting": the pointer moving within NODE_HIT_R (44) of
// the node immediately behind the live end removes the last segment, and that
// node becomes the live end. A beam is unwound one segment at a time by
// backing the pointer along it without releasing.
//
// The board is R9_UNIQUE (fixtures.ts). The trace draws three segments
// forward, then backs along them node by node — each backing move landing
// NODE_HIT_R - 2 from its target's center, never on it — until every segment
// is gone, and the trace is read back live after every step: nothing here
// releases. The whole held drag is recorded as the item's `retract` replay.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNotNull } from "../assert";
import { R9_UNIQUE } from "../fixtures";
import {
  captureReplay,
  createHarness,
  loadBoard,
  nodeCenter,
  resetTo,
  type Harness,
} from "../harness";
import { NODE_HIT_R } from "../notation";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes the last segment per backing move, unwinding the beam without a release", async () => {
  await resetTo(h, 1);
  await loadBoard(h, R9_UNIQUE);
  const at = (col: number, row: number): { x: number; y: number } =>
    nodeCenter(col, row, 4, 3);

  await captureReplay(h, "retract", async () => {
    // Draw T(0,0)-t(0,1)-t(1,1)-t(2,1) with the pointer held.
    h.debug.pointerDown(at(0, 0).x, at(0, 0).y);
    for (const [col, row] of [
      [0, 1],
      [1, 1],
      [2, 1],
    ] as const) {
      h.debug.pointerMove(at(col, row).x, at(col, row).y);
      await h.advance(4);
    }
    assertDeepEqual(
      h.snapshot().beams.triangle?.cells,
      [
        { col: 0, row: 0 },
        { col: 0, row: 1 },
        { col: 1, row: 1 },
        { col: 2, row: 1 },
      ],
      "the beam holds three segments before the unwind",
    );

    // Back along it: each move lands within NODE_HIT_R of the node
    // immediately behind the live end, and removes one segment.
    const steps: readonly {
      to: readonly [number, number];
      cells: { col: number; row: number }[];
    }[] = [
      {
        to: [1, 1],
        cells: [
          { col: 0, row: 0 },
          { col: 0, row: 1 },
          { col: 1, row: 1 },
        ],
      },
      {
        to: [0, 1],
        cells: [
          { col: 0, row: 0 },
          { col: 0, row: 1 },
        ],
      },
      { to: [0, 0], cells: [{ col: 0, row: 0 }] },
    ];
    for (const step of steps) {
      const target = at(step.to[0], step.to[1]);
      h.debug.pointerMove(target.x + (NODE_HIT_R - 2), target.y);
      await h.advance(4);

      const snapshot = h.snapshot();
      assertDeepEqual(
        snapshot.beams.triangle?.cells,
        step.cells,
        "a move within NODE_HIT_R of the node behind the live end removes " +
          "the last segment (specs/controls.md, Retracting)",
      );
      assertDeepEqual(
        snapshot.tracing?.live,
        { col: step.to[0], row: step.to[1] },
        "the backed-onto node becomes the live end",
      );
      assertNotNull(
        snapshot.tracing,
        "the unwind runs without releasing: the trace stays live throughout",
      );
    }

    h.debug.pointerUp();
    await h.advance(4);
  });
});
