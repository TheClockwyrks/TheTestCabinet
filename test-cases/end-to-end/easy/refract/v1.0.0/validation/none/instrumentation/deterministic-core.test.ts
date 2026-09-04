// Refract — instrumentation/deterministic-core: the simulation advances on the
// elapsed time it is handed, and reads nothing from the renderer.
//
// TWO OBSERVABLES, ONE PROPERTY. `specs/instrumentation.md` fixes that every
// rate is integrated against the frame's delta time — `advance(1, 1)` and
// `advance(1, 60)` cover the same second and must reach the same outcome — and
// that the dependency runs one way: whether a segment may be added is decided
// from the board and the beams alone, never from anything the renderer holds.
// So the first check covers one second of game time as a single frame and as
// sixty and requires `simTime` to gain 1.0 either way.
//
// The second takes one rules decision — a refused and an accepted segment —
// twice, and the contrast is whether the board has been RENDERED at all: once
// on a board posed and never drawn, once on the same board after five frames
// have drawn it. That is the contrast the spec sentence names, since what it
// forbids is the decision reading anything the renderer holds. No frame falls
// between the pointer calls in either run: `specs/state.md` has `pointer`
// refreshed from the runtime layer in every update, so a frame mid-gesture
// would grade the pointer mirror rather than the renderer.
//
// `advance` is called directly here, with this check's own divisions, because
// the step size is the SUBJECT; everything else in this directory steps the
// suite's plain 60 Hz. The board is posed through the surface's own
// `loadBoard` rather than through the harness helper for the same reason: the
// helper runs the frame that draws the pose, and the unrendered leg is the
// leg that must have no frame in it.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertDeepEqual, assertNull } from "../assert";
import { R2_FOREIGN } from "../fixtures";
import { boardToNotation, parseBoard } from "../notation";
import { captureStill, center, createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("one second as one frame and as sixty adds 1.0 to simTime either way", async () => {
  const start = (await h.snapshot()).simTime;

  await h.debug.advance(1, 1);
  const afterOne = (await h.snapshot()).simTime;
  assertCloseTo(afterOne - start, 1, 6, "one second covered as a single frame");

  await h.debug.advance(1, 60);
  const afterSixty = (await h.snapshot()).simTime;
  assertCloseTo(
    afterSixty - afterOne,
    1,
    6,
    "the same second covered as sixty frames",
  );
});

it("a refused and an accepted segment resolve identically with zero frames between the calls", async () => {
  // R2_FOREIGN: triangle presses T(0, 0); the move to s(1, 1) is refused (R2,
  // another channel's lens) and the move to t(1, 0) is accepted. The decision
  // must come from the board and the beams alone, so it cannot depend on
  // whether the board has been rendered before the gesture.
  const drawWith = async (
    label: string,
    rendered: boolean,
  ): Promise<{ afterRefusal: unknown; final: unknown }> => {
    const board = parseBoard(R2_FOREIGN);
    await h.debug.loadBoard(boardToNotation(board).split("\n"));
    if (rendered) await h.advance(5);
    const emitter = center(board, { col: 0, row: 0 });
    const foreign = center(board, { col: 1, row: 1 });
    const own = center(board, { col: 1, row: 0 });

    await h.debug.pointerDown(emitter.x, emitter.y);
    await h.debug.pointerMove(foreign.x, foreign.y);
    const afterRefusal = (await h.snapshot()).beams;
    assertDeepEqual(
      afterRefusal.triangle?.cells,
      [{ col: 0, row: 0 }],
      `the foreign-lens move is refused (${label})`,
    );
    await h.debug.pointerMove(own.x, own.y);
    await h.debug.pointerUp();

    const snapshot = await h.snapshot();
    assertNull(snapshot.tracing, "the release ends the trace");
    assertDeepEqual(
      snapshot.beams.triangle?.cells,
      [
        { col: 0, row: 0 },
        { col: 1, row: 0 },
      ],
      `the own-lens move is accepted (${label})`,
    );
    return { afterRefusal, final: snapshot.beams };
  };

  const unrendered = await drawWith(
    "a board that has never been rendered",
    false,
  );
  const rendered = await drawWith("a board five frames have drawn", true);

  await h.advance(1);
  await captureStill(h, "drive");

  assertDeepEqual(
    unrendered.afterRefusal,
    rendered.afterRefusal,
    "the refused segment leaves the same beams on a board that has been " +
      "rendered and on one that never has",
  );
  assertDeepEqual(
    unrendered.final,
    rendered.final,
    "the accepted segment leaves the same beams on a board that has been " +
      "rendered and on one that never has",
  );
});
