// scoring/score-starts-at-zero — a fresh session starts the score at 0, and it
// holds there until the first award lands.
//
// specs/scoring.md: "A fresh session starts the score at `0`, and the score
// changes only by the awards below." The reading is the exact integer twice
// over: 0 on the tick START begins the session, and still 0 after a long idle
// stretch in which no award's event resolves — the serve stays parked, so no
// hit, no destruction, no catch, and no clearing can land.
//
// The session is begun on the real player path (START), because the claim is
// about a fresh session rather than a posed one, and nothing is posed at all:
// what holds the score at zero is that no award event fires.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  advanceTicks,
  captureReplay,
  openHarness,
  startPlay,
  type Harness,
} from "../harness";

/** Four seconds of idle play: rings orbit, the serve stays parked. */
const IDLE_TICKS = 240;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("starts at zero and holds there while no award lands", async () => {
  const fresh = await startPlay(h);
  assertEqual(fresh.screen, "playing", "the session START begins");
  assertEqual(fresh.score, 0, "the fresh session's score");

  const after = await captureReplay(h, "held-at-zero", () =>
    advanceTicks(h, IDLE_TICKS),
  );

  assertEqual(after.score, 0, "the score after an idle stretch with no award");
});
