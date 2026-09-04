// press/allowance-is-five — a build phase grants five rock stamps, and the sixth
// drop is refused.
//
// THE ALLOWANCE IS THE WHOLE ECONOMY OF THE BUILD PHASE. Placing a rock costs no
// Charge (`specs/scrap-press.md`), so nothing but the stamp count limits how much
// of the yard a level fills: five is what makes a level a decision rather than a
// filling-in. A build that grants six has a different game, and one that grants
// four leaves a recipe the player was collecting for out of reach.
//
// So the count is read at the phase's opening and after every one of six drops,
// which is what separates "the sixth was refused" from "the fifth never landed".

import { afterEach, beforeEach, it } from "vitest";
import { STAMPS_PER_LEVEL } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  type Harness,
} from "../harness";

/** Six clear anchors, one more than the allowance grants. */
const ANCHORS = [10, 14, 18, 22, 26, 30].map((col) => ({ col, row: 8 }));

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("accepts five drops in a build phase and refuses the sixth", async () => {
  openYard(h);

  const opened = h.snapshot();
  assertEqual(opened.phase, "build", "the phase a run opens on");
  assertEqual(
    opened.stampsLeft,
    STAMPS_PER_LEVEL,
    "the stamps a build phase opens with",
  );

  for (const [at, anchor] of ANCHORS.entries()) {
    h.debug.placeRock(anchor.col, anchor.row);
    const s = h.snapshot();
    const drop = at + 1;
    const landed = Math.min(drop, STAMPS_PER_LEVEL);
    assertEqual(
      s.structures.length,
      landed,
      `the structures on the yard after drop ${drop} of ${ANCHORS.length}, ` +
        `against an allowance of ${STAMPS_PER_LEVEL}`,
    );
    assertEqual(
      s.stampsLeft,
      STAMPS_PER_LEVEL - landed,
      `the stamps left after drop ${drop} of ${ANCHORS.length}`,
    );
  }

  await h.advance(1);
  captureStill(h, "spent");
});
