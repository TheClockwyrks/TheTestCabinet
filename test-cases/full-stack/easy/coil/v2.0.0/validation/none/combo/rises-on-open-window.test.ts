// combo/rises-on-open-window — an eat inside the window raises M by one.
//
// specs/scoring.md: "An eaten pellet resolves the multiplier before it awards the
// points", and against an open window `M` becomes "One higher, up to
// `COMBO_MAX`". The window is "open while time remains on it".
//
// The multiplier is posed at 2 with a part-spent window, which is a state a round
// reaches by playing and which is clear of both ends of the rule: it is not the
// opening `1`, where a build that simply set `M` to `2` on any eat would pass, and
// it is not `COMBO_MAX`, where the cap decides the answer instead. Exactly one
// higher is the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { COMBO_WINDOW } from "../constants";
import {
  arrangeEat,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";

/** The multiplier in force before the eat. */
const COMBO = 2;

/** Seconds left on the window: part spent, and open. */
const WINDOW = COMBO_WINDOW / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises the multiplier by exactly one on an eat inside the window", async () => {
  const scene = await arrangeEat(h, { combo: COMBO, comboWindow: WINDOW });
  assertEqual(scene.snapshot.combo, COMBO, "the posed multiplier");
  assertGreaterThan(scene.snapshot.comboWindow, 0, "the window at the eat");

  const after = await captureReplay(h, "rise", () => h.tick());

  assertEqual(after.combo, COMBO + 1, "the multiplier after the eat");
});
