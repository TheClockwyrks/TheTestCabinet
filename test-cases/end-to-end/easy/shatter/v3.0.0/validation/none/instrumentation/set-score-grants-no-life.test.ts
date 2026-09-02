// instrumentation/set-score-grants-no-life — posing the score carries it across
// `EXTRA_LIFE_STEP` boundaries and grants no extra ship.
//
// WHY THIS IS AN ITEM OF ITS OWN. `specs/progression.md` grants a ship each time
// the score crosses a multiple of `EXTRA_LIFE_STEP` (`10,000`), and
// `specs/instrumentation.md` cuts the pose out of that rule in as many words:
// "`setScore` grants no extra ship, whatever multiple of `EXTRA_LIFE_STEP` it
// carries the score across." The award belongs to the SCORING PATH — the tick a
// rock or the saucer was destroyed — and a pose is a precondition rather than an
// event. A build that hangs the award off the score CHANGING rather than off the
// kill hands a free ship to every scenario in this case that poses a score, which
// is why the rule is stated and why it is graded here.
//
// AND THE READING IS TAKEN A TICK LATER AS WELL AS AT ONCE. The wrong model this is
// hunting is a build that notices the crossing in its own update rather than inside
// the operation, so each pose is followed by a real tick before the ships are
// counted; a check that read the count the instant the pose returned would miss it
// entirely.
//
// THE SCORES ARE CHOSEN TO CROSS IN EVERY DIRECTION. One just under the first
// boundary, one just over it, one several boundaries above, and one back down to
// nothing — so a build that awards on any crossing, in either direction, or on any
// multiple rather than the first, reads as a different ship count.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { EXTRA_LIFE_STEP, START_LIVES } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";

/** The scores posed, in order: under, over, far over, and back to nothing. */
const POSED_SCORES = [
  EXTRA_LIFE_STEP - 1,
  EXTRA_LIFE_STEP + 1,
  3 * EXTRA_LIFE_STEP + 500,
  0,
] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries the score across the boundary and leaves the ships alone", async () => {
  await startPlaying(h);
  assertEqual(
    (await h.snapshot()).lives,
    START_LIVES,
    "the ships the run opened with",
  );

  for (const score of POSED_SCORES) {
    await h.debug.setScore(score);
    // A real tick between the pose and the count, so a build that grants the ship
    // in its own update rather than inside the operation is caught.
    const s = await h.advance(1);
    assertEqual(s.score, score, `setScore(${score})`);
    assertEqual(
      s.lives,
      START_LIVES,
      `the ships left after setScore(${score})`,
    );
  }

  await captureStill(h, "posed");
});
