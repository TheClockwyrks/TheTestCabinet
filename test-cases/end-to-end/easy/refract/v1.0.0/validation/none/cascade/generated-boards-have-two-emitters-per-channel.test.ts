// cascade/generated-boards-have-two-emitters-per-channel — every generated
// board carries the first n of CHANNELS, two emitters each.
//
// specs/modes/cascade.md "The generator": the channels present are the first n
// of CHANNELS, and every channel present carries exactly two emitters. The
// generator is asked for five boards at every tier through `generateBoard`
// (specs/instrumentation.md), and each is read off the snapshot as it arrives
// and held to those two rows of the contract table. How many channels a tier
// asks for is cascade/tier-channel-count's point; here the subject is which
// channels they are and how many emitters each gets.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThanOrEqual,
} from "../assert";
import { CHANNELS, MAX_TIER, channelsPresent } from "../notation";
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

it("every board generated at every tier carries the first n of CHANNELS with two emitters each", async () => {
  const generated = await generateAtTiers(
    h,
    PER_TIER,
    async ({ tier, round }) => {
      if (tier === MAX_TIER && round === PER_TIER) {
        await captureStill(h, "emitters");
      }
    },
  );

  for (const { tier, round, board } of generated) {
    const at = `tier ${tier}, board ${round}`;

    const present = channelsPresent(board);
    assertGreaterThanOrEqual(present.length, 1, `${at}: channels present`);
    assertDeepEqual(
      present,
      CHANNELS.slice(0, present.length),
      `${at}: the channels are the first n of CHANNELS`,
    );

    for (const channel of present) {
      const emitters = board.nodes.filter(
        (node) => node.kind === "emitter" && node.channel === channel,
      ).length;
      assertEqual(emitters, 2, `${at}: emitters of ${channel}`);
    }
  }
});
