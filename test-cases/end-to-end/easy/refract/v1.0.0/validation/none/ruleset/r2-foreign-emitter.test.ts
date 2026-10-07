// ruleset/r2-foreign-emitter — R2 Exclusion: a beam never meets an EMITTER of
// another channel.
//
// THE POSE. `R2_FOREIGN`:
//
//   TtT
//   .s.
//   S.S
//
// The square beam is drawn one permitted segment onto its own lens, S(0, 2) to
// s(1, 1), and from there swept onto T(2, 0) — an emitter of the triangle
// channel, diagonally adjacent. The target is adjacent, its segment fresh, its
// diagonal's 2x2 block unused and its capacity untouched, so the channel is the
// only rule in play (specs/beams.md R2). Refusal reads as the enforcement table
// states it: the beam is unchanged and the trace stays live.

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

it("refuses a move onto another channel's emitter", async () => {
  const board = await loadBoard(h, R2_FOREIGN);

  await pressAt(h, board, { col: 0, row: 2 });
  await moveOver(h, board, { col: 1, row: 1 });
  const before = await h.snapshot();
  assertDeepEqual(
    before.beams.square?.cells,
    [
      { col: 0, row: 2 },
      { col: 1, row: 1 },
    ],
    "the square beam reaches its own lens before the foreign move",
  );

  await moveOver(h, board, { col: 2, row: 0 });
  const after = await h.snapshot();

  await h.advance(1);
  await captureStill(h, "refused");
  await h.debug.pointerUp();

  assertDeepEqual(
    after.beams,
    before.beams,
    "the beam is unchanged by the move onto another channel's emitter",
  );
  assertDeepEqual(
    after.tracing,
    before.tracing,
    "the trace stays live through the refused move onto the foreign emitter",
  );
});
