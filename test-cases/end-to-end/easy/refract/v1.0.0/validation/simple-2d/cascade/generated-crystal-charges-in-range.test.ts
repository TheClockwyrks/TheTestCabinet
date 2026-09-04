// Refract — cascade/generated-crystal-charges-in-range: every generated crystal carries a legal charge count.
//
// specs/modes/cascade.md "The generator": a crystal's charges are 1 to MAX_CHARGES (3),
// "never above MAX_CHARGES". The narrower range a TIER states is
// cascade/tier-crystal-count-and-charges's point; here the subject is the
// generator's outer bound, which no tier may cross. The sweep is the same
// twenty-five-board walk the solvability check makes — each board really solved
// to reach the next — and each board is held against that row of the contract
// as it arrives. The still is the first MAX_TIER board, the fullest shape the
// ladder emits.

import { afterEach, beforeEach, it } from "vitest";
import {
  captureStill,
  createHarness,
  oracleBoard,
  resetTo,
  startCascade,
  type Harness,
} from "../harness";
import { assertCrystalChargesInRange, sweepGenerated } from "./sweep";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("emits only crystals carrying 1 to MAX_CHARGES charges, across twenty-five boards", async () => {
  await resetTo(h, 1);
  await startCascade(h);

  await sweepGenerated(h, 25, {
    onBoard: (snapshot, round) => {
      if (round === 21) captureStill(h, "charges");
      assertCrystalChargesInRange(
        oracleBoard(snapshot),
        `generated board ${round}`,
      );
    },
  });
});
