// scoring/small-scores-100 — a destroyed Small pays exactly 100.
//
// `specs/scoring.md` fixes the figure: "A Small rock is destroyed | `SCORE_SMALL` |
// `100`", paid once, on the destruction itself, whatever destroyed the body. It is
// the largest of the three rock figures and the only one paid by a destruction that
// leaves NOTHING behind (`specs/rocks.md`: a destroyed Small leaves nothing), so a
// build that pays its fragments rather than its kills reads `0` here while still
// reading something for a Large and a Medium.
//
// THE SMALL IS POSED DIRECTLY rather than reached by shooting a Large down through
// its ladder: the shortest route to the event is to put the body under test on the
// field and destroy it, and a route through two parents would let the split table
// decide an item about a score.
//
// WHAT IS READ IS THE DELTA, NOT THE SCORE, against a run posed at `POSED_SCORE`
// (`1234`): a build that ASSIGNS the figure reads `100` where a build that adds it
// reads `1334`, and one paying a neighbouring figure reads `1234` plus that figure.
//
// THE FIELD HOLDS NOTHING ELSE THAT COULD PAY. `startPlaying` shuts the wave loop
// and the saucer's arrival and empties every roster, so the only event between the
// two readings is the Small being destroyed.
//
// A SMALL CARRIES ONE HIT UNDER EITHER VARIANT (`specs/rocks.md` gives it
// `ROCK_HEALTH.small` of `1`), so the round that lands is the round that destroys
// it, and this check reads the same event in both checklists.

import { afterEach, beforeEach, it } from "vitest";
import { SCORE_SMALL } from "../../src/constants";
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

it("raises the score by exactly SCORE_SMALL when a Small is destroyed", async () => {
  startPlaying(h);
  h.debug.setScore(POSED_SCORE);
  const id = poseRock(h, "small", QUIET_SPOT.x, QUIET_SPOT.y);
  const before = h.snapshot().score;

  const after = await destroyRock(h, id);
  captureStill(h, "score");

  assertEqual(
    after.score - before,
    SCORE_SMALL,
    "the figure a destroyed Small pays (specs/scoring.md)",
  );
});
