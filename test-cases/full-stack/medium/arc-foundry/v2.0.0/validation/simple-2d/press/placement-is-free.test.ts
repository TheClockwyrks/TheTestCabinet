// press/placement-is-free — Charge is never spent on a stamp.
//
// `specs/economy.md` names exactly two sinks, refinement and a tower upgrade, and
// `specs/scrap-press.md` says the rest plainly: placing a rock is free, so the
// allowance is the only limit on how many rocks a level places. The two rules
// together are what make the build phase's decision about WHERE rather than about
// whether the player can afford to look.
//
// Charge is read either side of a whole level's worth of drops, so a build that
// charges even one per rock is caught rather than rounded away.

import { afterEach, beforeEach, it } from "vitest";
import { STAMPS_PER_LEVEL } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  type Harness,
} from "../harness";

/** Charge in the bank, well above anything a rock could plausibly cost. */
const CHARGE = 100;

/** A whole allowance of clear anchors. */
const ANCHORS = [10, 14, 18, 22, 26].map((col) => ({ col, row: 8 }));

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves Charge untouched across a whole level of drops", async () => {
  openYard(h, { charge: CHARGE });
  assertEqual(h.snapshot().charge, CHARGE, "the Charge in the bank");

  for (const [at, anchor] of ANCHORS.entries()) {
    h.debug.placeRock(anchor.col, anchor.row);
    const s = h.snapshot();
    assertEqual(
      s.structures.length,
      at + 1,
      `the structures on the yard after drop ${at + 1}`,
    );
    assertEqual(
      s.charge,
      CHARGE,
      `the Charge after drop ${at + 1} of ${STAMPS_PER_LEVEL}: placing a rock ` +
        `is free (specs/scrap-press.md)`,
    );
  }

  await h.advance(1);
  captureStill(h, "hud");
});
