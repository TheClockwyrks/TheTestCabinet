// ruleset/r5-crystal-capacity — R5: a crystal carrying n charges is crossed
// at most n times; the crossing after the n-th is refused.
//
// THE POSE. `CRYSTAL_TWICE` carries a 2-charge crystal one triangle beam must
// cross twice:
//
//   Tt.T
//   .2t.
//   tt..
//
// The route T(0,0) → 2(1,1) → t(0,2) → t(1,2) → 2(1,1) → t(1,0) → t(2,1)
// enters the crystal twice — both charges spent, both crossings completed by
// leaving — and leaves the live end at t(2,1), a fresh horizontal segment
// away from the crystal. That move would be the THIRD entry of a 2-charge
// crystal: refused, and for no other reason (the segment is unused, the
// crystal is channel-neutral, no diagonal is involved).
//
// The `spent` the snapshot derives — "the crossings the drawn beams have
// begun on it" (specs/instrumentation.md) — is asserted as the precondition:
// the crystal really is at its n-th crossing when the (n+1)-th is attempted.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { CRYSTAL_TWICE } from "../fixtures";
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

it("refuses the crossing after the n-th of an n-charge crystal", async () => {
  const board = await loadBoard(h, CRYSTAL_TWICE);

  // Cross the crystal twice, ending on the lens beside it.
  await pressAt(h, board, { col: 0, row: 0 });
  await moveOver(h, board, { col: 1, row: 1 });
  await moveOver(h, board, { col: 0, row: 2 });
  await moveOver(h, board, { col: 1, row: 2 });
  await moveOver(h, board, { col: 1, row: 1 });
  await moveOver(h, board, { col: 1, row: 0 });
  await moveOver(h, board, { col: 2, row: 1 });
  const before = await h.snapshot();
  const crystal = before.board.nodes.find((node) => node.kind === "crystal");
  assertEqual(crystal?.charges, 2, "the crystal carries two charges");
  assertEqual(
    crystal?.spent,
    2,
    "both charges are spent by the two crossings before the refused move",
  );
  assertDeepEqual(
    before.tracing,
    { channel: "triangle", live: { col: 2, row: 1 } },
    "the live end sits a fresh segment away from the crystal",
  );

  // The third crossing of a twice-crossed, 2-charge crystal.
  await moveOver(h, board, { col: 1, row: 1 });
  const after = await h.snapshot();

  await h.advance(1);
  await captureStill(h, "refused");
  await h.debug.pointerUp();

  assertDeepEqual(
    after.beams,
    before.beams,
    "the beam is unchanged by the crossing after the n-th",
  );
  assertDeepEqual(
    after.tracing,
    before.tracing,
    "the trace stays live through the refused crossing",
  );
});
