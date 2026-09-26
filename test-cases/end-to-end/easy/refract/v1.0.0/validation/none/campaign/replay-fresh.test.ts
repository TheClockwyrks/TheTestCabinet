// Refract — campaign/replay-fresh: entering a board starts it empty, replay
// or not.
//
// specs/modes/campaign.md: "Entering a board always starts it with every beam
// empty, whether it is a first attempt or a replay. Progress is per board and
// is never partially banked." Board 1 is really solved, and re-entered from
// the grid: the beams it was solved with must be gone, every beam empty and
// none complete, exactly as a first attempt starts.
//
// GETTING BACK TO THE GRID. The solve leaves the game on the solved screen,
// and specs/modes/campaign.md gives that screen two exits to `select`: its
// third menu choice, back to select, and the `back` action. This item's
// subject is on the far side of that step, not the step itself, so it must
// not pin one of the two — `gridFromSolved` takes whichever the build honours,
// and which one that is stays campaign/solved-back-choice's and
// campaign/solved-back-action's verdict alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  driveCourse,
  fireAction,
  type Harness,
} from "../harness";
import { gridFromSolved } from "./reading";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("re-enters a solved board with every beam empty", async () => {
  await driveCourse(h, 1);
  await gridFromSolved(h);

  await fireAction(h, "confirm"); // board 1, solved, reopens
  await captureStill(h, "fresh");

  const replay = await h.snapshot();
  assertEqual(replay.screen, "playing", "the solved board can be re-entered");
  assertEqual(replay.boardIndex, 0, "the board re-entered is board 1");
  for (const [channel, beam] of Object.entries(replay.beams)) {
    assertDeepEqual(beam.cells, [], `${channel}'s beam starts empty`);
    assertEqual(
      beam.complete,
      false,
      `${channel}'s beam is not banked as complete`,
    );
  }
});
