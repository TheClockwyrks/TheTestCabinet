// Refract — instrumentation/deterministic-core: the simulation advances on
// elapsed time and reads nothing from the renderer.
//
// Two halves, both from specs/instrumentation.md "A deterministic core":
//
//   1. Every rate is integrated against the delta time the game is given, so
//      one second of game time reaches the same simTime however it is divided
//      into frames. Under this engine the step size is the CLOCK's, so the
//      suite builds two harnesses of its own — one whose every frame is worth
//      a whole second, one whose frames are worth a sixtieth — and covers the
//      same second on each: one frame against sixty.
//
//   2. Whether a segment may be added is decided from the board and the beams
//      alone, never from anything the renderer holds. So the same rules
//      decision — a refused move (R2's foreign lens) and an accepted one —
//      is taken on BOTH harnesses with ZERO frames advanced between the
//      pointer calls: no render, no update, nothing but the call itself, and
//      the two step sizes must resolve it identically.
//
// This is the one suite that builds harnesses with clocks of its own; the
// shared 120 Hz default is deliberately not used, because the step size is
// what is under test.

import { ConstantClock } from "@test-cabinet/structured-2d";
import { afterEach, it } from "vitest";
import {
  assertCloseTo,
  assertDeepEqual,
  assertLessThanOrEqual,
  assertNotNull,
} from "../assert";
import { R2_FOREIGN } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  moveToCell,
  pressCell,
  resetTo,
  type Harness,
} from "../harness";
import type { RefractSnapshot } from "../surface";

/** The harnesses an `it` built, disposed whatever its verdict. */
let built: Harness[] = [];

async function harnessWithStep(stepMs: number): Promise<Harness> {
  const h = await createHarness({ clock: new ConstantClock(stepMs) });
  built.push(h);
  return h;
}

afterEach(() => {
  for (const h of built) h.dispose();
  built = [];
});

/**
 * The rules decision, taken with zero frames advanced between the calls:
 * press the triangle emitter, attempt the move onto the square lens (which
 * R2 refuses), then take the move onto the triangle lens (which every limit
 * permits), and release. Returns the snapshot after the release.
 */
function decideOnBoardAndBeamsAlone(h: Harness): RefractSnapshot {
  pressCell(h, { col: 0, row: 0 });
  assertNotNull(h.snapshot().tracing, "the press begins a trace at the call");

  // The refused segment: s(1,1) is the other channel's lens (R2). Nothing
  // advances; the refusal must resolve in the call, from board + beams alone.
  moveToCell(h, { col: 1, row: 1 });
  const refused = h.snapshot();
  assertLessThanOrEqual(
    refused.beams.triangle?.cells.length ?? 0,
    1,
    "the refused move adds no segment",
  );
  assertDeepEqual(
    refused.tracing?.live,
    { col: 0, row: 0 },
    "the refused move leaves the trace live where it was",
  );

  // The accepted segment: t(1,0) is the channel's own lens, adjacent, fresh.
  moveToCell(h, { col: 1, row: 0 });
  assertDeepEqual(
    h.snapshot().beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ],
    "the accepted move adds the segment at the call",
  );

  h.debug.pointerUp();
  return h.snapshot();
}

it("one second as a single frame and as sixty frames adds 1.0 to simTime either way", async () => {
  const coarse = await harnessWithStep(1000);
  const fine = await harnessWithStep(1000 / 60);
  await resetTo(coarse, 1);
  await resetTo(fine, 1);

  const coarseStart = coarse.snapshot().simTime;
  await coarse.advance(1);
  const coarseDelta = coarse.snapshot().simTime - coarseStart;
  assertCloseTo(coarseDelta, 1, 6, "one frame worth a whole second");

  const fineStart = fine.snapshot().simTime;
  await fine.advance(60);
  const fineDelta = fine.snapshot().simTime - fineStart;
  assertCloseTo(fineDelta, 1, 6, "sixty frames worth a sixtieth each");

  assertCloseTo(
    coarseDelta,
    fineDelta,
    6,
    "the same second, however it was divided into frames",
  );
});

it("a refused and an accepted segment resolve identically with zero frames between the calls", async () => {
  const coarse = await harnessWithStep(1000);
  const fine = await harnessWithStep(1000 / 60);
  await resetTo(coarse, 1);
  await resetTo(fine, 1);
  await loadBoard(coarse, R2_FOREIGN);
  await loadBoard(fine, R2_FOREIGN);

  const coarseOutcome = decideOnBoardAndBeamsAlone(coarse);
  const fineOutcome = decideOnBoardAndBeamsAlone(fine);

  // The decision was the board's and the beams' alone: two step sizes, one
  // outcome.
  assertDeepEqual(
    coarseOutcome.beams,
    fineOutcome.beams,
    "both step sizes resolve the two moves to the same beams",
  );
  assertDeepEqual(
    coarseOutcome.tracing,
    fineOutcome.tracing,
    "both step sizes end the trace the same way",
  );

  // Evidence: the board the rules decision was read from, with the accepted
  // segment drawn.
  await coarse.advance(1);
  captureStill(coarse, "drive");
});
