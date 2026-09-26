// ruleset/r2-foreign-lens — R2 Exclusion: a beam never meets a LENS of another
// channel.
//
// THE POSE. `R2_FOREIGN`:
//
//   TtT
//   .s.
//   S.S
//
// The triangle trace begun at T(0, 0) moves onto s(1, 1) — a lens of the
// square channel, diagonally adjacent. The target is adjacent, its segment
// fresh, its diagonal's 2x2 block unused and its capacity untouched, so the
// channel is the only rule in play (specs/beams.md R2). Refusal reads as the
// enforcement table states it: the beam is unchanged and the trace stays live.

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

it("refuses a move onto another channel's lens", async () => {
  const board = await loadBoard(h, R2_FOREIGN);

  await pressAt(h, board, { col: 0, row: 0 });
  const before = await h.snapshot();
  assertDeepEqual(
    before.tracing,
    { channel: "triangle", live: { col: 0, row: 0 } },
    "the press at T(0, 0) begins the triangle trace",
  );

  await moveOver(h, board, { col: 1, row: 1 });
  const after = await h.snapshot();

  await h.advance(1);
  await captureStill(h, "refused");
  await h.debug.pointerUp();

  assertDeepEqual(
    after.beams,
    before.beams,
    "the beam is unchanged by the move onto another channel's lens",
  );
  assertDeepEqual(
    after.tracing,
    before.tracing,
    "the trace stays live through the refused move onto the foreign lens",
  );
});
