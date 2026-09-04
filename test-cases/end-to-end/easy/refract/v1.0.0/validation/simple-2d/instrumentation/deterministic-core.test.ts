// Refract — instrumentation/deterministic-core: the simulation advances on
// elapsed time and reads nothing from the renderer.
//
// specs/instrumentation.md "A deterministic core": every rate is integrated
// against the delta time the game is given, so an interval of game time
// reaches the same state however it was divided into frames — and the
// dependency runs one way, the simulation reading nothing from the renderer:
// whether a segment may be added is decided from the board and the beams
// alone.
//
// TWO HALVES. The first covers one second of game time under two scripted
// clocks — as a single 1000 ms frame and as sixty 1000/60 ms frames — and
// simTime, which accumulates the delta time of every update
// (specs/instrumentation.md "Snapshot shape"), must gain 1.0 either way.
//
// The second takes one rules decision — a refused and an accepted segment on
// R2_FOREIGN — twice, and the contrast is whether the board has been RENDERED
// at all: once on a board posed and never drawn, once on the same board after
// five frames have drawn it. That is the contrast the spec sentence names,
// since what it forbids is the decision reading anything the renderer holds.
// No frame falls between the pointer calls in either run: specs/state.md has
// `pointer` refreshed from the runtime layer in every update, so a frame
// mid-gesture would grade the pointer mirror rather than the renderer. The two
// runs must leave identical beams, and each call's effect is asserted in its
// own aftermath.

import { ConstantClock } from "@test-cabinet/simple-2d";
import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertDeepEqual,
  assertEqual,
  assertNotNull,
} from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  type CellRef,
  type Harness,
} from "../harness";
import { cellX, cellY } from "../notation";

/** R2_FOREIGN's rows, as the surface's own loadBoard takes them. */
const ROWS: readonly string[] = ["TtT", ".s.", "S.S"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("adds 1.0 to simTime whether one second is one frame or sixty", async () => {
  // One second as a single frame…
  const one = await createHarness({ clock: new ConstantClock(1000) });
  try {
    await resetTo(one, 1);
    const opened = one.snapshot().simTime;
    await one.advance(1);
    assertCloseTo(
      one.snapshot().simTime - opened,
      1,
      6,
      "one second covered as a single frame adds 1.0 to simTime",
    );
  } finally {
    one.dispose();
  }

  // …and the same second as sixty frames.
  const sixty = await createHarness({ clock: new ConstantClock(1000 / 60) });
  try {
    await resetTo(sixty, 1);
    const opened = sixty.snapshot().simTime;
    await sixty.advance(60);
    assertCloseTo(
      sixty.snapshot().simTime - opened,
      1,
      6,
      "one second covered as sixty frames adds 1.0 to simTime",
    );
  } finally {
    sixty.dispose();
  }
});

it("decides a segment from the board and the beams alone", async () => {
  // The pointer sequence: press the triangle emitter T(0,0), move to the
  // foreign lens s(1,1) — refused by R2 — then to the own lens t(1,0) —
  // accepted — and release. `rendered` says whether the board was drawn
  // before the gesture; the outcome must not depend on it.
  const drive = async (rendered: boolean): Promise<CellRef[]> => {
    h.debug.loadBoard(ROWS);
    if (rendered) await h.advance(5);
    h.debug.pointerDown(cellX(0, 3), cellY(0, 3));
    h.debug.pointerMove(cellX(1, 3), cellY(1, 3));
    const refused = h.snapshot();
    assertEqual(
      (refused.beams.triangle?.cells ?? []).some(
        (cell) => cell.col === 1 && cell.row === 1,
      ),
      false,
      "the move onto the foreign lens is refused (specs/beams.md R2)",
    );
    assertNotNull(refused.tracing, "a refused move leaves the trace live");
    h.debug.pointerMove(cellX(1, 3), cellY(0, 3));
    h.debug.pointerUp();
    return h.snapshot().beams.triangle?.cells ?? [];
  };

  // On a board that has never been rendered: the rules had nothing but the
  // board and the beams to read.
  const unrendered = await drive(false);
  assertDeepEqual(
    unrendered,
    [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ],
    "the refused segment is absent and the accepted one drawn, on a board " +
      "that has never been rendered",
  );

  // The same calls on a board five frames have drawn resolve identically.
  const rendered = await drive(true);
  await h.advance(1);
  captureStill(h, "drive");
  assertDeepEqual(
    rendered,
    unrendered,
    "the same pointer calls resolve identically on a board that has been " +
      "rendered and on one that never has",
  );
});
