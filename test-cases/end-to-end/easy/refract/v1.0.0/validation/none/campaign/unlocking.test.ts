// Refract — campaign/unlocking: solving a board unlocks the next.
//
// specs/modes/campaign.md: "Solving a board unlocks the next board by number:
// solving board n unlocks board n + 1". Board 1 is really solved and the state
// read back — `unlockedCount` 2, `solvedBoards` holding board 1 alone. That a
// SECOND solve of the same board changes neither field is its own rule and its
// own point, campaign/replay-changes-no-unlock-state.
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

it("unlocks board 2 on the first solve", async () => {
  const walk = await driveCourse(h, 1);
  assertEqual(walk.final.unlockedCount, 2, "solving board 1 unlocks board 2");
  assertDeepEqual(
    walk.final.solvedBoards,
    [0],
    "board 1 alone is recorded solved",
  );

  await gridFromSolved(h);
  await captureStill(h, "unlocked");
});
