// scoring/medium-scores-50 — a destroyed Medium pays exactly 50.
//
// `specs/scoring.md` fixes the figure: "A Medium rock is destroyed |
// `SCORE_MEDIUM` | `50`", paid once, on the destruction itself, whatever destroyed
// the body. This item owns that one number, and it is a different number from the
// Large's: a build that pays one flat figure for any rock passes exactly one of the
// three size items and fails the other two, which is what makes a failed grade name
// the rule that is broken.
//
// THE MEDIUM IS POSED DIRECTLY rather than reached by shooting a Large down first.
// `specs/instrumentation.md` adds a rock of any of the three sizes, so the shortest
// route to the event is to put the body under test on the field and destroy it — and
// a route through the parent would let a wrong split table (`specs/rocks.md`: a
// destroyed Large leaves two Mediums) decide an item about a score. What a Large
// leaves behind is the `rocks` group's item.
//
// WHAT IS READ IS THE DELTA, NOT THE SCORE, against a run posed at `POSED_SCORE`
// (`1234`): a build that ASSIGNS the figure reads `50` where a build that adds it
// reads `1284`, and one paying a neighbouring figure reads `1234` plus that figure.
//
// THE FIELD HOLDS NOTHING ELSE THAT COULD PAY. `startPlaying` shuts the wave loop
// and the saucer's arrival and empties every roster, so the only event between the
// two readings is the Medium coming apart. Its two Small fragments appear on that
// tick and pay nothing.
//
// UNDER `warhead` THE MEDIUM TAKES TWO ROUNDS, and the delta is still `50`: the
// figure is paid "on the destruction alone, however many hits it took".

import { afterEach, beforeEach, it } from "vitest";
import { SCORE_MEDIUM } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  startPlaying,
  type Harness,
} from "../harness";
import { POSED_SCORE, QUIET_SPOT, destroyRock } from "./scene";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("raises the score by exactly SCORE_MEDIUM when a Medium is destroyed", async () => {
  startPlaying(h);
  h.debug.setScore(POSED_SCORE);
  const id = poseRock(h, "medium", QUIET_SPOT.x, QUIET_SPOT.y);
  const before = h.snapshot().score;

  const after = await destroyRock(h, id);
  captureStill(h, "score");

  assertEqual(
    after.score - before,
    SCORE_MEDIUM,
    "the figure a destroyed Medium pays (specs/scoring.md)",
  );
});
