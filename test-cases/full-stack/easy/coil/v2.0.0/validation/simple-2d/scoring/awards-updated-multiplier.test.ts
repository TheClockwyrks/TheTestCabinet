// scoring/awards-updated-multiplier — an eat scores at the multiplier it leaves,
// not the one it met.
//
// specs/scoring.md: "An eaten pellet resolves the multiplier before it awards the
// points." With the window open at the eat, `M` becomes one higher, and "the eat
// then awards `PELLET_POINTS * M` at that new `M`". Posed at an `M` of 3 with an
// open window, the tick therefore leaves `M` at 4 and adds 40, and a build that
// awarded at the multiplier in force BEFORE the eat would add 30 — which is what
// this point separates from `scoring/pellet-awards-ten`, where both readings give
// the same answer.
//
// The window is posed at a full `COMBO_WINDOW` rather than at some remainder,
// because what "open" means at a boundary is the `combo` category's to decide;
// this point needs it open beyond argument.

import { afterEach, beforeEach, it } from "vitest";
import { COMBO_WINDOW, PELLET_POINTS } from "../constants";
import { assertEqual } from "../assert";
import {
  arrangeEat,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";

/** The multiplier the eat meets, one short of the one it awards at. */
const MET = 3;

/** A score the round is already carrying, so the award is read as an increment. */
const CARRIED = 500;

/** Ticks of clear travel before the head reaches the pellet. */
const RUN_UP = 3;

/** Ticks run after the eat, so what it left behind is on the recording. */
const SETTLE = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("raises M to four and awards forty from an M of three", async () => {
  arrangeEat(h, {
    score: CARRIED,
    combo: MET,
    comboWindow: COMBO_WINDOW,
    runUp: RUN_UP + 1,
  });

  const after = await captureReplay(h, "award", async () => {
    await h.tick(RUN_UP);
    const eaten = await h.tick();
    await h.tick(SETTLE);
    return eaten;
  });

  assertEqual(after.combo, MET + 1, "the multiplier after the eat");
  assertEqual(
    after.score,
    CARRIED + PELLET_POINTS * (MET + 1),
    "the score after one eat at the raised multiplier",
  );
});
