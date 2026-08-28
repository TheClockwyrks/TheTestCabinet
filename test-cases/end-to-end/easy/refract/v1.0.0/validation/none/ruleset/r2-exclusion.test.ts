// ruleset/r2-exclusion — R2 Exclusion: a beam never meets an emitter or a
// lens of another channel.
//
// THE POSE. `R2_FOREIGN` carries both channels the rule needs:
//
//   TtT
//   .s.
//   S.S
//
//   1. The triangle trace begun at T(0, 0) moves onto s(1, 1) — a LENS of
//      another channel, diagonally adjacent. Refused.
//   2. The square beam [S(0, 2), s(1, 1)] moves onto T(2, 0) — an EMITTER of
//      another channel, diagonally adjacent. Refused.
//
// Each refused target is adjacent, its segment fresh, its diagonal's 2x2 block
// unused, and its capacity untouched, so the channel is the only rule in play
// (specs/beams.md R2; the enforcement table: the beam is unchanged and the
// trace stays live).

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { R2_FOREIGN } from "../fixtures";
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

it("refuses a move onto another channel's lens, and onto another channel's emitter", async () => {
  const board = await loadBoard(h, R2_FOREIGN);

  // The foreign LENS: triangle's trace, begun at its own emitter, swept onto
  // the square lens diagonally below.
  await pressAt(h, board, { col: 0, row: 0 });
  const beforeLens = await h.snapshot();
  assertDeepEqual(
    beforeLens.tracing,
    { channel: "triangle", live: { col: 0, row: 0 } },
    "the press at T(0, 0) begins the triangle trace",
  );
  await moveOver(h, board, { col: 1, row: 1 });
  const afterLens = await h.snapshot();
  await h.debug.pointerUp();

  // The foreign EMITTER: square's beam drawn one legal segment onto its own
  // lens, then swept onto the triangle emitter diagonally above.
  await pressAt(h, board, { col: 0, row: 2 });
  await moveOver(h, board, { col: 1, row: 1 });
  const beforeEmitter = await h.snapshot();
  assertDeepEqual(
    beforeEmitter.beams.square?.cells,
    [
      { col: 0, row: 2 },
      { col: 1, row: 1 },
    ],
    "the square beam reaches its own lens before the foreign move",
  );
  await moveOver(h, board, { col: 2, row: 0 });
  const afterEmitter = await h.snapshot();

  await h.advance(1);
  await captureStill(h, "refused");
  await h.debug.pointerUp();

  assertDeepEqual(
    afterLens.beams,
    beforeLens.beams,
    "the beam is unchanged by the move onto another channel's lens",
  );
  assertDeepEqual(
    afterLens.tracing,
    beforeLens.tracing,
    "the trace stays live through the refused move onto the foreign lens",
  );
  assertDeepEqual(
    afterEmitter.beams,
    beforeEmitter.beams,
    "the beam is unchanged by the move onto another channel's emitter",
  );
  assertDeepEqual(
    afterEmitter.tracing,
    beforeEmitter.tracing,
    "the trace stays live through the refused move onto the foreign emitter",
  );
});
