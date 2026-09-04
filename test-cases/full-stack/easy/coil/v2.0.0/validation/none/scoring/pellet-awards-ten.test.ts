// scoring/pellet-awards-ten — an eat at a multiplier of one is worth ten points.
//
// specs/scoring.md: "Eating a pellet awards `PELLET_POINTS` (`10`) multiplied by
// the combo multiplier in force after the eat resolves", and a window that is
// closed at the eat puts `M` back to `1`. So the tick that eats here awards
// `PELLET_POINTS * 1`, and what this decides is that figure alone: the multiplier
// arithmetic on top of it is the `scoring/awards-updated-multiplier` point, and
// which multiplier an eat resolves to is the `combo` category's.
//
// The score is posed away from zero so a build that ASSIGNS a score rather than
// adding to it fails here: 250 posed and 260 read back is the increment the
// specification states, where 10 read back would be the same number reached by
// forgetting the score it was carrying.
//
// The world is the chain and the pellet the tick eats, and nothing else — the
// obstacle course cleared, respawn off, so what the tick resolves is the one eat.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PELLET_POINTS } from "../constants";
import {
  arrangeEat,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";

/** A score the round is already carrying, so the award is read as an increment. */
const CARRIED = 250;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises the score by exactly PELLET_POINTS when the window is closed", async () => {
  await arrangeEat(h, { score: CARRIED, combo: 1, comboWindow: 0 });

  const after = await captureReplay(h, "award", () => h.tick());

  assertEqual(after.score, CARRIED + PELLET_POINTS, "the score after one eat");
});
