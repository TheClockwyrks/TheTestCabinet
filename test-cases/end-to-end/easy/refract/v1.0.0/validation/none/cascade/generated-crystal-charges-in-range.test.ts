// cascade/generated-crystal-charges-in-range — every generated crystal carries
// a legal charge count.
//
// specs/modes/cascade.md "The generator": a crystal's charges are 1 to
// MAX_CHARGES (3), "never above MAX_CHARGES". The generator is asked for five
// boards at every tier through `generateBoard` (specs/instrumentation.md), and
// every crystal on each is held to that ceiling as the board arrives. The
// narrower range a TIER states is cascade/tier-crystal-count-and-charges's
// point; here the subject is the generator's outer bound, which no tier may
// cross.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertNotNull } from "../assert";
import { MAX_CHARGES, MAX_TIER } from "../notation";
import {
  captureStill,
  createHarness,
  generateAtTiers,
  type Harness,
} from "../harness";

const PER_TIER = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("every crystal on every generated board carries 1 to MAX_CHARGES charges", async () => {
  const generated = await generateAtTiers(
    h,
    PER_TIER,
    async ({ tier, round }) => {
      if (tier === MAX_TIER && round === PER_TIER)
        await captureStill(h, "charges");
    },
  );

  for (const { tier, round, board } of generated) {
    const at = `tier ${tier}, board ${round}`;
    for (const node of board.nodes) {
      if (node.kind !== "crystal") continue;
      const where = `${at}: crystal at (${node.col}, ${node.row})`;
      assertNotNull(node.charges, `${where}: charges`);
      assertBetween(node.charges ?? 0, 1, MAX_CHARGES, `${where}: charges`);
    }
  }
});
