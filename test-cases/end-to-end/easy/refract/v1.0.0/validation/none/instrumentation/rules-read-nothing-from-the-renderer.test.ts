// Refract — instrumentation/rules-read-nothing-from-the-renderer: whether a
// segment may be added is decided from the board and the beams alone.
//
// `specs/instrumentation.md` fixes that the dependency runs one way: whether a
// segment may be added is decided from the board and the beams alone, never
// from anything the renderer holds.
//
// So this check takes one rules decision — a refused and an accepted segment —
// twice, and the contrast is whether the board has been RENDERED at all: once
// on a board posed and never drawn, once on the same board after five frames
// have drawn it. That is the contrast the spec sentence names, since what it
// forbids is the decision reading anything the renderer holds. No frame falls
// between the pointer calls in either run: `specs/state.md` has `pointer`
// refreshed from the runtime layer in every update, so a frame mid-gesture
// would grade the pointer mirror rather than the renderer.
//
// The board is posed through the surface's own `loadBoard` rather than through
// the harness helper, because the helper runs the frame that draws the pose and
// the unrendered leg is the leg that must have no frame in it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNull } from "../assert";
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
