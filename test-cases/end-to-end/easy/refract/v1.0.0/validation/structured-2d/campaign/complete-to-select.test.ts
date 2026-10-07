// Refract — campaign/complete-to-select: the complete screen's first choice
// returns to the grid.
//
// specs/modes/campaign.md "The complete screen": it offers two choices, in this
// order, back to select then back to title, with `up` and `down` moving the
// highlight and wrapping at both ends. No next board is offered — that is what
// makes complete the campaign's ending rather than another solved screen — so
// the menu holds exactly two choices, which the wrap reads: down twice from the
// arrival highlight comes back to the first. Then the first choice is taken,
// and it goes to select.

import { afterEach, beforeEach, it } from "vitest";
import { CAMPAIGN_LENGTH } from "../notation";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  driveCourse,
  tapAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("offers exactly two choices, the first of them back to select", async () => {
  await driveCourse(h, CAMPAIGN_LENGTH);
  assertEqual(
    h.snapshot().screen,
    "complete",
    "precondition: the course ends on complete (see complete-reached)",
  );

  // The menu holds exactly two choices, so down wraps after the second.
  await tapAction(h, "down");
  assertEqual(h.snapshot().menuIndex, 1, "down highlights the second choice");
  await tapAction(h, "down");
  assertEqual(
    h.snapshot().menuIndex,
    0,
    "a third choice is not offered: down wraps back to the first",
  );

  await tapAction(h, "confirm");
  await h.advance(1);
  captureStill(h, "select");
  assertEqual(h.snapshot().screen, "select", "the first choice goes to select");
});
