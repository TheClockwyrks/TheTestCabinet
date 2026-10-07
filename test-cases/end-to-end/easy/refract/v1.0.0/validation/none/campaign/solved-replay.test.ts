// Refract — campaign/solved-replay: the replay choice enters the same board
// again.
//
// specs/modes/campaign.md, the solved screen: the second choice, replay,
// "Enters the same board again, with every beam empty, and goes to playing",
// and "up and down move the highlight". One down from the arrival highlight
// reaches it; the wording of the choice is the build's own, its effect is
// not.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  driveCourse,
  fireAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("re-enters the same board on playing with every beam empty", async () => {
  const walk = await driveCourse(h, 1);
  assertEqual(walk.final.screen, "solved", "solving board 1 lands on solved");

  await fireAction(h, "down"); // second choice: replay
  await fireAction(h, "confirm");
  await captureStill(h, "replayed");

  const replay = await h.snapshot();
  assertEqual(replay.screen, "playing", "the replay choice goes to playing");
  assertEqual(replay.boardIndex, 0, "the board re-entered is the same one");
  for (const [channel, beam] of Object.entries(replay.beams)) {
    assertDeepEqual(beam.cells, [], `${channel}'s beam starts empty`);
  }
});
