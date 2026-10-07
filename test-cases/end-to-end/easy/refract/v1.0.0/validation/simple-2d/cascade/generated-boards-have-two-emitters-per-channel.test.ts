// Refract — cascade/generated-boards-have-two-emitters-per-channel: every generated board carries the first n of CHANNELS, two emitters each.
//
// specs/modes/cascade.md "The generator": the channels present are the first n
// of CHANNELS, and every channel present carries exactly two emitters. How
// many channels a tier asks for is cascade/tier-channel-count's point; here
// the subject is which channels they are and how many emitters each gets. The
// generator is asked for five boards at every tier through `generateBoard`
// (specs/instrumentation.md), and each board is held against that row of the
// contract as it arrives. The still is the last MAX_TIER board, the fullest
// shape the ladder emits.

import { afterEach, beforeEach, it } from "vitest";
import {
  captureStill,
  createHarness,
  generateAtTiers,
  resetTo,
  type Harness,
} from "../harness";
import { MAX_TIER } from "../notation";
import { assertTwoEmittersPerChannel } from "./sweep";

const PER_TIER = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("emits only boards with two emitters per channel present, five at every tier", async () => {
  await resetTo(h);

  await generateAtTiers(h, PER_TIER, ({ tier, round, board }) => {
    if (tier === MAX_TIER && round === PER_TIER) captureStill(h, "emitters");
    assertTwoEmittersPerChannel(board, `tier ${tier}, board ${round}`);
  });
});
