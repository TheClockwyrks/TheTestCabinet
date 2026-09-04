// cascade/generated-boards-have-two-emitters-per-channel — every generated
// board carries the first n of CHANNELS, two emitters each.
//
// specs/modes/cascade.md "The generator": the channels present are the first n
// of CHANNELS, and every channel present carries exactly two emitters. The
// sweep reads each board off the snapshot as it arrives and holds it to those
// two rows of the contract table — solving as it goes (the only way the
// sequence advances), with a different seed from the solvability sweep so the
// two points read different draws of the generator. How many channels a tier
// asks for is cascade/tier-channel-count's point; here the subject is which
// channels they are and how many emitters each gets.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThanOrEqual,
} from "../assert";
import { CHANNELS, channelsPresent } from "../notation";
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

it("every board of the sweep carries the first n of CHANNELS with two emitters each", async () => {
  const sweep = await solveGenerated(
    h,
    SWEEP,
    SEED,
    async (_snapshot, index) => {
      if (index === SWEEP - 1) await captureStill(h, "emitters");
    },
  );

  for (const [index, board] of sweep.boards.entries()) {
    const at = `board ${index + 1}`;

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
