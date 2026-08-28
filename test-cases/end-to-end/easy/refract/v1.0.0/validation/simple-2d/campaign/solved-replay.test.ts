// Refract — campaign/solved-replay: the replay choice enters the same board
// again.
//
// Board 1 is really solved, one down moves the solved screen's highlight to
// its second choice — replay, the order is fixed even though the wording is
// the build's — and the confirm must re-enter the same board: the same
// boardIndex, screen playing, every beam empty (specs/modes/campaign.md
// "replay ... Enters the same board again, with every beam empty, and goes to
// playing").

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  driveCourse,
  resetTo,
  startCampaign,
  tapAction,
  type Harness,
} from "../harness";
import { assertBeamsEmpty } from "./helpers";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("the second choice re-enters the solved board with every beam empty", async () => {
  await resetTo(h);
  await startCampaign(h);

  const solved = await driveCourse(h, 1);
  assertEqual(solved.screen, "solved", "board 1 solved, on the solved screen");
  assertEqual(solved.boardIndex, 0, "the solved board is board 1");

  await tapAction(h, "down");
  assertEqual(
    h.snapshot().menuIndex,
    1,
    "down moves the highlight to the second choice, replay " +
      "(specs/modes/campaign.md fixes the order)",
  );

  await tapAction(h, "confirm");
  captureStill(h, "replayed");

  const replayed = h.snapshot();
  assertEqual(
    replayed.screen,
    "playing",
    "the replay choice goes to playing (specs/modes/campaign.md)",
  );
  assertEqual(
    replayed.boardIndex,
    0,
    "the replay enters the same board again (specs/modes/campaign.md)",
  );
  assertBeamsEmpty(replayed, "the replay starts with every beam empty");
});
