// scoring/death-scores-nothing-catch — a life lost to the bear pays nothing.
//
// The third of `specs/progression.md`'s three ways a crossing ends badly, read
// for what `specs/scoring.md` pays for it: nothing. `scoring/death.ts` beside
// this file carries the reasoning the three share, the posed score, and the two
// readings each of them is decided on.
//
// THE BEAR IS POSED ON THE CRITTER'S OWN TILE WITH EVERY FACULTY BUT THE CATCH
// HELD OFF — no sensing, no routing, no travel — so what reaches the critter is
// the catch and nothing the hunt did on the way.
//
// WHAT THIS DOES NOT DECIDE. That a catch costs a life at all is
// `progression/catch-costs-life`; a drowning and a crush are the two points
// beside this one. This point is the score, across a bear reaching the critter.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ROW_NEAR, START_COL } from "../constants";
import {
  createHarness,
  poseBear,
  startCrossing,
  type Harness,
} from "../harness";
import { POSED_SCORE, die, scoredNothing } from "./death";

/** The one frame a catch needs. */
const ONE_TICK = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the score exactly as it stood through a catch", async () => {
  startCrossing(h);
  h.debug.setScore(POSED_SCORE);
  poseBear(h, START_COL, ROW_NEAR, {
    sense: false,
    routing: false,
    travel: false,
  });
  // The one gate this death's requirement is (specs/instrumentation.md).
  h.debug.setCatchTest(true);

  const before = h.snapshot();
  assertEqual(before.phase, "crossing", "a live crossing before the catch");

  scoredNothing("a bear reaching the critter", await die(h, "score", ONE_TICK));
});
