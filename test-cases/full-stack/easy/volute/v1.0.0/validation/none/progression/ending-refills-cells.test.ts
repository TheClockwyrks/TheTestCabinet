// progression/ending-refills-cells — a dismissed ending restores the cells
// remaining.
//
// THE SPEC LINE. `specs/progression.md` — "Interludes and endings":
// "dismissing it returns the game to the title screen with every value of a
// fresh run restored", and `specs/state.md`: "On `title` the run's fields hold
// their opening values: score `0`, level `1`, three cells, the level's full
// quota still to emit, pressure `0`, chain step `1`, no machinery, an empty
// channel, no projectiles, an aim of `270` degrees, and every timer at `0`."
// This point's value is "three cells".
//
// ONE VALUE, ONE POINT. `progression/ending.ts` carries the ended run every
// one of these points is read off and says why each figure is moved off its
// fresh-run value first; this file reads the cells remaining and nothing else.
//
// WHY IT IS A POINT. The ending was reached by a spend that took the count to
// 0, so a build that leaves the count where the ended run left it opens its
// next run with nothing to spend and ends it on the first arrival.
//
// THE TOLERANCE. None. A cell count is a count, and the standing tolerances
// make it exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CELLS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { dismissEnding } from "./ending";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("restores the three cells when an ending is dismissed", async () => {
  const dismissal = await dismissEnding(h);
  await captureStill(h, "cells");

  assertEqual(
    dismissal.posed.cells,
    0,
    "the cells the ended run had left before the press",
  );
  assertEqual(
    dismissal.title.cells,
    CELLS,
    "the cells a dismissed ending restored",
  );
});
