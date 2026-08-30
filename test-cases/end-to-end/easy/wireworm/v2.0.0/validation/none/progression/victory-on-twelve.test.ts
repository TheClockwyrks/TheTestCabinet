// progression/victory-on-twelve — cutting the last segment of level 12 wins the
// run.
//
// `specs/progression.md`, Winning and losing: "Victory | The last worm segment
// of level `12` is removed. | The victory bonus is paid and the game moves to
// the `victory` screen." `TOTAL_LEVELS` is `12`, and Clearing a level makes the
// ordinary advance conditional on the clear being "below level `TOTAL_LEVELS`",
// so the twelfth clear is the one that ends the run.
//
// The run is posed at level `12` with its whole worm as one segment, and a real
// bolt takes it away — the same removal that clears any other level, on the one
// level where the outcome differs. A build that treats level `12` like any other
// answers with the `playing` screen on a thirteenth level; a build that ends
// every run on a clear would fail `progression/level-advances` instead; a
// correct build answers `victory`.
//
// What the victory PAYS is `scoring/victory-bonus` and what its screen SHOWS is
// `screens/victory-screen`; this point reads only that the run ended in a win.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { TOTAL_LEVELS } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { cutLastSegment } from "./run";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("moves to the victory screen on the twelfth clear", async () => {
  await startPlaying(h, { level: TOTAL_LEVELS });

  await cutLastSegment(h);

  await captureStill(h, "victory");
  const after = await h.snapshot();
  assertLength(
    after.worms,
    0,
    "precondition: the bolt removed the last segment (specs/worm.md)",
  );
  assertEqual(
    after.screen,
    "victory",
    `the screen after clearing level ${TOTAL_LEVELS}`,
  );
});
