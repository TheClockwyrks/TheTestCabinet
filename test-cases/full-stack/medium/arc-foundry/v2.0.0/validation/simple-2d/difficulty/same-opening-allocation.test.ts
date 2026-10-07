// difficulty/same-opening-allocation — a run opens with the same Charge, Grid
// Integrity, stamp allowance and refinement level at every difficulty.
//
// `specs/difficulty.md` names all four among the values "identical at every
// difficulty": "the starting Charge, the starting Grid Integrity, the stamp
// allowance, the refinement track and its costs". This point reads the opening
// allocation off a fresh run at each of the three and holds the three against each
// other; `difficulty/same-refinement-track` decides the track itself.
//
// What the figures ARE is decided by the economy and campaign checklists, so a
// build with the wrong starting Charge fails there rather than twice over here.

import { afterEach, beforeEach, it } from "vitest";
import { captureStill, createHarness, openRun, type Harness } from "../harness";
import { sameAtEveryDifficulty } from "./same";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("opens every run with the same Charge, Integrity, stamps and refinement", async () => {
  await sameAtEveryDifficulty(
    "a run's opening allocation",
    async (difficulty) => {
      openRun(h, { difficulty });
      const s = h.snapshot();
      return {
        charge: s.charge,
        integrity: s.integrity,
        stampsLeft: s.stampsLeft,
        refinement: s.refinement,
      };
    },
  );
  // The allocations are read and compared above; the one frame the still is of
  // draws the last run opened, and the build phase is untimed.
  await h.advance(1);
  captureStill(h, "same");
});
