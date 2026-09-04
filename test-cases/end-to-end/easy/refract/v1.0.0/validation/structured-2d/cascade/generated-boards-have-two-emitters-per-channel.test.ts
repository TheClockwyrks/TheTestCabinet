// Refract — cascade/generated-boards-have-two-emitters-per-channel: every generated board carries the first n of CHANNELS, two emitters each.
//
// specs/modes/cascade.md "The generator": the channels present are the first n of CHANNELS, and
// every channel present carries exactly two emitters. How many channels a tier
// asks for is cascade/tier-channel-count's point; here the subject is which
// channels they are and how many emitters each gets.
//
// The same twenty-five-board sweep boards-are-solvable drives is read here:
// every arrived board is held against that row of the contract, and the board
// the sweep leaves the player on afterwards — a fresh tier-5 board — is checked
// too and kept as the picture.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  boardFromSnapshot,
  captureStill,
  createHarness,
  solveGenerated,
  tapAction,
  type Harness,
} from "../harness";
import { assertTwoEmittersPerChannel } from "./helpers";

const SEED = 1;
const BOARDS = 25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("emits only boards with two emitters per channel present, across the whole sweep", async () => {
  const solved = await solveGenerated(h, BOARDS, SEED);
  for (let k = 0; k < solved.length; k += 1) {
    assertTwoEmittersPerChannel(solved[k].board, `board ${k + 1}`);
  }

  // One more board past the sweep, rendered on playing: the picture, and one
  // more reading of the same clause.
  await tapAction(h, "confirm");
  const next = h.snapshot();
  assertEqual(next.screen, "playing", "NEXT BOARD lands on playing");
  captureStill(h, "emitters");
  assertTwoEmittersPerChannel(boardFromSnapshot(next), `board ${BOARDS + 1}`);
});
