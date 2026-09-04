// Refract — cascade/generated-boards-have-two-emitters-per-channel: every generated board carries the first n of CHANNELS, two emitters each.
//
// specs/modes/cascade.md "The generator": the channels present are the first n of CHANNELS, and
// every channel present carries exactly two emitters. How many channels a tier
// asks for is cascade/tier-channel-count's point; here the subject is which
// channels they are and how many emitters each gets. The sweep is the same
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
import { assertTwoEmittersPerChannel, sweepGenerated } from "./sweep";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("emits only boards with two emitters per channel present, across twenty-five boards", async () => {
  await resetTo(h, 1);
  await startCascade(h);

  await sweepGenerated(h, 25, {
    onBoard: (snapshot, round) => {
      if (round === 21) captureStill(h, "emitters");
      assertTwoEmittersPerChannel(
        oracleBoard(snapshot),
        `generated board ${round}`,
      );
    },
  });
});
