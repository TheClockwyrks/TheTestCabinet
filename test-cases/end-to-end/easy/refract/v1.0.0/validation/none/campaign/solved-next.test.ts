// Refract — campaign/solved-next: the solved screen offers the next board
// first.
//
// specs/modes/campaign.md, the solved screen: the choices come "in this
// order" with next board first when the solved board is not board 24, and
// "The first choice is highlighted on arriving at the screen" — so solving
// board 1 lands on solved with `menuIndex` 0, and confirm enters board 2 on
// playing with every beam empty.

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

it("arrives with next board highlighted, and confirm enters board 2 empty", async () => {
  const walk = await driveCourse(h, 1);
  assertEqual(walk.final.screen, "solved", "solving board 1 lands on solved");
  assertEqual(
    walk.final.menuIndex,
    0,
    "the first choice, next board, is highlighted on arrival",
  );

  await h.advance(1); // render the solved screen the snapshot reported
  await captureStill(h, "solved");

  await fireAction(h, "confirm");
  const next = await h.snapshot();
  assertEqual(next.screen, "playing", "confirm enters the next board");
  assertEqual(next.boardIndex, 1, "the next board is board 2");
  for (const [channel, beam] of Object.entries(next.beams)) {
    assertDeepEqual(beam.cells, [], `${channel}'s beam starts empty`);
  }
});
