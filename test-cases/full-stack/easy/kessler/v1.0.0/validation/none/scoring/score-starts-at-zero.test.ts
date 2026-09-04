// scoring/score-starts-at-zero — a fresh session starts the score at 0, and it
// holds there until the first award lands.
//
// specs/scoring.md: "A fresh session starts the score at `0`, and the score
// changes only by the awards below." The reading is the exact integer twice
// over: 0 on the tick the session begins, and still 0 after a long idle stretch
// in which no award's event resolves — the serve stays parked, so no hit, no
// destruction, no catch, and no clearing can land.
//
// THE SESSION IS BEGUN THROUGH THE HARNESS'S OWN SEQUENCE, not by pressing START
// on the title menu: a build with a correct score and a broken confirm key must
// fail the menu points and pass this one, and the pressed route is already
// graded by `controls/enter-confirms` and `screens/start-begins-session`.
//
// THE RECORDER IS ARMED FOR THE END OF THE IDLE STRETCH. Four seconds of a
// parked ball over an untouched field is a world at rest, and a written
// recording holds three hundred frames, so most of the idle is driven outside
// the bracket and what is recorded is a short run-up around the final reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  advanceTicks,
  captureReplay,
  openHarness,
  startFreshSession,
  type Harness,
} from "../harness";

/** Four seconds of idle play: rings orbit, the serve stays parked. */
const IDLE_TICKS = 240;
/** Ticks of that idle the recorder is armed for, around the final reading. */
const RECORDED_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("starts at zero and holds there while no award lands", async () => {
  const fresh = await startFreshSession(h);
  assertEqual(fresh.screen, "playing", "the session's screen");
  assertEqual(fresh.score, 0, "the fresh session's score");

  await advanceTicks(h, IDLE_TICKS - RECORDED_TICKS);

  const after = await captureReplay(h, "held-at-zero", () =>
    advanceTicks(h, RECORDED_TICKS),
  );

  assertEqual(after.score, 0, "the score after an idle stretch with no award");
});
