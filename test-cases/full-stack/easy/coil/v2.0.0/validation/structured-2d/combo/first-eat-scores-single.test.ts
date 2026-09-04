// combo/first-eat-scores-single — the first pellet of a round meets a closed
// window.
//
// specs/scoring.md: the multiplier "starts each round at `1`", the window is
// "closed once that time is spent", an eat resolved against a closed window sets
// `M` to `1`, and the file states the consequence outright — "The first pellet of
// a round meets a closed window, so it scores at `M` of `1`."
//
// TWO READINGS, AND THE FIRST IS THE PRECONDITION THE CLAIM RESTS ON. A round
// opens with the window closed, which specs/instrumentation.md also requires of
// `reset` ("the combo multiplier at `1` with its window closed"). Then the eat
// resolves and `M` is still `1`, and the award is `PELLET_POINTS` at that
// multiplier rather than at some carried-over one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PELLET_POINTS } from "../../src/constants";
import {
  arrangeEat,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("resolves the first eat of a round at a multiplier of one", async () => {
  const scene = arrangeEat(h);
  assertEqual(scene.snapshot.combo, 1, "the multiplier a round opens at");
  assertEqual(scene.snapshot.comboWindow, 0, "the window a round opens with");
  assertEqual(scene.snapshot.score, 0, "the score a round opens at");

  const after = await captureReplay(h, "first", () => h.tick());

  assertEqual(after.combo, 1, "the multiplier the first eat resolved at");
  assertEqual(after.score, PELLET_POINTS, "the points the first eat awarded");
});
