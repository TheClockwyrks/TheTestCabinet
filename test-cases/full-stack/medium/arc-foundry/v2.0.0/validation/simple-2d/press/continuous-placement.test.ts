// press/continuous-placement — a drop re-arms the press, so five rocks go down
// back to back.
//
// `specs/scrap-press.md` calls it continuous placement and makes it the rhythm of
// the build phase: pull once, place five. A build that empties the hand after
// every drop makes the player pull the press five times for the same five rocks,
// which is the sort of thing that reads as nothing on paper and as friction on
// every level of a fifty-wave run.
//
// AND IT ENDS WHERE THE ALLOWANCE DOES. The hand is armed after each of the first
// four drops and empty after the fifth, because placement ends when the allowance
// is spent — a build that re-arms a sixth rock is offering a placement it cannot
// honour.

import { afterEach, beforeEach, it } from "vitest";

import { STAMPS_PER_LEVEL } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  pressAction,
  type Harness,
} from "../harness";

/** One anchor per stamp of the allowance. */
const ANCHORS = [10, 14, 18, 22, 26].map((col) => ({ col, row: 8 }));

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("arms the next rock after each drop until the allowance is spent", async () => {
  openYard(h);

  // The press is pulled once, and once only.
  await pressAction(h, "stamp");
  assertEqual(
    h.snapshot().held.active,
    true,
    "the rock the press armed when it was pulled",
  );

  for (const [at, anchor] of ANCHORS.entries()) {
    h.debug.placeRock(anchor.col, anchor.row);
    const s = h.snapshot();
    const drop = at + 1;
    const last = drop === STAMPS_PER_LEVEL;
    assertEqual(
      s.structures.length,
      drop,
      `the structures on the yard after drop ${drop}`,
    );
    assertEqual(
      s.held.active,
      !last,
      last
        ? `the hand after the last drop of the allowance, which ends placement`
        : `the rock armed on the cursor after drop ${drop}, with ` +
            `${STAMPS_PER_LEVEL - drop} stamps still to spend`,
    );
    if (drop === 1) {
      await h.advance(1);
      captureStill(h, "held");
    }
  }
});
