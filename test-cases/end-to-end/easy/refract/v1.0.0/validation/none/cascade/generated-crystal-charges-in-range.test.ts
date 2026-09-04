// cascade/generated-crystal-charges-in-range — every generated crystal carries
// a legal charge count.
//
// specs/modes/cascade.md "The generator": a crystal's charges are 1 to
// MAX_CHARGES (3), "never above MAX_CHARGES". The sweep reads each board off
// the snapshot as it arrives and holds every crystal on it to that ceiling —
// solving as it goes (the only way the sequence advances), with a different
// seed from the solvability sweep so the two points read different draws of the
// generator. The narrower range a TIER states is
// cascade/tier-crystal-count-and-charges's point; here the subject is the
// generator's outer bound, which no tier may cross.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertNotNull } from "../assert";
import { MAX_CHARGES } from "../notation";
import {
  captureStill,
  createHarness,
  solveGenerated,
  type Harness,
} from "../harness";

const SWEEP = 25;
const SEED = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("every crystal of the sweep carries 1 to MAX_CHARGES charges", async () => {
  const sweep = await solveGenerated(
    h,
    SWEEP,
    SEED,
    async (_snapshot, index) => {
      if (index === SWEEP - 1) await captureStill(h, "charges");
    },
  );

  for (const [index, board] of sweep.boards.entries()) {
    const at = `board ${index + 1}`;
    for (const node of board.nodes) {
      if (node.kind !== "crystal") continue;
      const where = `${at}: crystal at (${node.col}, ${node.row})`;
      assertNotNull(node.charges, `${where}: charges`);
      assertBetween(node.charges ?? 0, 1, MAX_CHARGES, `${where}: charges`);
    }
  }
});
