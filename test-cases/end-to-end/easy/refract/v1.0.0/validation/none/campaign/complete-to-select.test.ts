// Refract — campaign/complete-to-select: the complete screen's first choice
// returns to the grid.
//
// specs/modes/campaign.md, the complete screen: "It offers two choices, in this
// order: back to select, and back to title. The first is highlighted on
// arriving at the screen, up and down move the highlight, wrapping at both
// ends". No next board is offered — that is what makes complete the campaign's
// ending rather than another solved screen — so the menu is exactly two long,
// which the wrap reads: down twice from the arrival highlight comes back to the
// first choice. Then the first choice is taken, and it goes to select.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  driveCourse,
  fireAction,
  type Harness,
} from "../harness";
import { CAMPAIGN_LENGTH } from "../notation";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("offers exactly two choices, the first of them back to select", async () => {
  const walk = await driveCourse(h, CAMPAIGN_LENGTH);
  assertEqual(
    walk.final.screen,
    "complete",
    "precondition: the course ends on complete (see complete-reached)",
  );

  // Exactly two choices: down reaches the second, down again wraps to the
  // first. A third choice — a next board — would leave the highlight at 2.
  await fireAction(h, "down");
  assertEqual(
    (await h.snapshot()).menuIndex,
    1,
    "down moves to the second choice",
  );
  await fireAction(h, "down");
  assertEqual(
    (await h.snapshot()).menuIndex,
    0,
    "down wraps to the first: the screen carries exactly two choices, so no " +
      "next board is offered",
  );

  await fireAction(h, "confirm");
  await captureStill(h, "select");
  assertEqual(
    (await h.snapshot()).screen,
    "select",
    "the first choice is back to select",
  );
});
