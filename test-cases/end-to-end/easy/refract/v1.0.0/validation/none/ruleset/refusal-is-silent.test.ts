// ruleset/refusal-is-silent — a refused move changes nothing and keeps the
// trace live, so a player can sweep the pointer across the board and draw
// only permitted segments (specs/beams.md, Enforcement; specs/controls.md,
// Extending).
//
// THE POSE. `R5_SPENT_CRYSTAL`:
//
//   T1T
//   S.S
//
// with the triangle beam left ending on the crystal, the square trace begun
// at S(0, 1) sweeps across three illegal targets in turn:
//
//   1. T(0, 0) — an emitter of another channel (R2).
//   2. 1(1, 0) — a crystal whose one charge is already spent (R5).
//   3. T(2, 0) — a node two columns from the live end (R1).
//
// After every sample the whole beam set must be identical and the trace still
// live on the square channel. The sweep is driven with the REAL mouse — one
// frame per sample — because the declared output is a replay, and a replay
// only holds the frames that actually ran; the surface's own pointer
// operations drive none.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { R5_SPENT_CRYSTAL } from "../fixtures";
import {
  captureReplay,
  center,
  createHarness,
  loadBoard,
  mouseGlide,
  mousePress,
  mouseRelease,
  traceCells,
  type Harness,
  type RefractSnapshot,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("a sweep across three illegal targets leaves the beam identical and the trace live throughout", async () => {
  const board = await loadBoard(h, R5_SPENT_CRYSTAL);

  // The crystal's charge is spent by the triangle beam entering and staying.
  await traceCells(h, [
    { col: 0, row: 0 },
    { col: 1, row: 0 },
  ]);

  const swept = await captureReplay(h, "sweep", async () => {
    const start = center(board, { col: 0, row: 1 });
    await mousePress(h, start.x, start.y);
    const begun = await h.snapshot();

    const readings: RefractSnapshot[] = [];
    for (const target of [
      { col: 0, row: 0 }, // another channel's emitter
      { col: 1, row: 0 }, // the spent crystal
      { col: 2, row: 0 }, // two columns from the live end
    ]) {
      const at = center(board, target);
      await mouseGlide(h, at.x, at.y);
      readings.push(await h.snapshot());
    }
    await mouseRelease(h);
    return { begun, readings };
  });

  assertDeepEqual(
    swept.begun.tracing,
    { channel: "square", live: { col: 0, row: 1 } },
    "the press at S(0, 1) begins the square trace",
  );
  for (const [index, reading] of swept.readings.entries()) {
    assertDeepEqual(
      reading.beams,
      swept.begun.beams,
      `illegal target ${index + 1}: every beam is identical`,
    );
    assertDeepEqual(
      reading.tracing,
      swept.begun.tracing,
      `illegal target ${index + 1}: the trace is still live`,
    );
  }
});
