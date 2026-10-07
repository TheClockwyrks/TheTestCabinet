// scoring/large-scores-20 — a destroyed Large pays exactly 20.
//
// `specs/scoring.md` fixes the figure: "A Large rock is destroyed | `SCORE_LARGE` |
// `20`", paid once, on the destruction itself, whatever destroyed the body. This
// item owns that one number.
//
// WHAT IS READ IS THE DELTA, NOT THE SCORE. The run is posed at `POSED_SCORE`
// (`1234`) rather than opened at zero, so a build that ASSIGNS the figure instead
// of adding it parts company with a build that adds it: the conformant build
// reports `1254`, the assigning one `20`, and one paying a neighbouring figure
// reports `1234` plus that figure. Every wrong model in the table therefore reads
// as its own number, and the four figures are `20`, `50`, `100` and `200`, so no
// two of them collide.
//
// THE FIELD HOLDS NOTHING ELSE THAT COULD PAY. `startPlaying` shuts the wave loop
// and the saucer's arrival and empties every roster, so no wave arrives behind the
// scenario and no saucer wanders into it; the only event between the two readings
// is the Large coming apart. Its two Medium fragments appear on that same tick and
// pay nothing — nothing but a DESTRUCTION scores — which is exactly what the delta
// asserts.
//
// UNDER `warhead` THE LARGE TAKES THREE ROUNDS, and the delta still has to be `20`:
// `specs/scoring.md` pays the figure "on the destruction alone, however many hits it
// took". `destroyRock` spends whatever rounds the build's armor demands and reports
// the tick it came apart, so the same check reads the same number under both
// variants. What a chipping hit pays is `armor`'s item, not this one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SCORE_LARGE } from "../constants";
import {
  captureStill,
  createHarness,
  destroyRock,
  poseRock,
  startPlaying,
  type Harness,
} from "../harness";
import { POSED_SCORE, QUIET_SPOT } from "./scene";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises the score by exactly SCORE_LARGE when a Large is destroyed", async () => {
  await startPlaying(h);
  await h.debug.setScore(POSED_SCORE);
  const id = await poseRock(h, "large", QUIET_SPOT.x, QUIET_SPOT.y);
  const before = (await h.snapshot()).score;

  const { result } = await destroyRock(h, id);
  await captureStill(h, "score");

  assertEqual(
    result.snapshot.score - before,
    SCORE_LARGE,
    "the figure a destroyed Large pays (specs/scoring.md)",
  );
});
