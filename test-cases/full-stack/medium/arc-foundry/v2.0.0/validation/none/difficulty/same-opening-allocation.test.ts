// difficulty/same-opening-allocation — every run opens with the same
// Charge, Grid Integrity, stamp allowance and refinement level.
//
// THE REQUIREMENT. `specs/difficulty.md` is explicit about the negative: "A
// difficulty sets the number of waves and the constants of the per-wave health
// scaling, and nothing else. Every other value is identical at every difficulty:
// the starting Charge, the starting Grid Integrity, the stamp allowance, the
// refinement track and its costs, the Load roster's base figures, the bounties,
// the leak values, the wave-clear bonus, the component stats, and the recipes."
// That sentence names several separately observable things, and a build can get
// any one of them wrong on its own, so each is its own point.
//
// THE COMPARISON IS BETWEEN THE DIFFICULTIES, not against the specification's
// numbers: what the starting Charge is, what a Slug's bounty is and what a
// Charged Capacitor hits for are each decided by a point of their own on the
// economy, campaign and component checklists, and a build that gets one of them
// wrong should fail that point once rather than twice over. What is decided HERE
// is that whichever figure a build carries, it carries the same one at Easy, at
// Medium and at Hard.
//
// HOW IT IS DECIDED. A run is opened at each of the three difficulties and the
// four figures `specs/campaign.md` gives a run's opening allocation are read off
// the snapshot, then held against each other.

import { afterEach, beforeEach, it } from "vitest";
import { captureStill, createHarness, openRun, type Harness } from "../harness";
import { sameAtEveryDifficulty } from "./same";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens every run with the same Charge, Integrity, stamps and refinement", async () => {
  await sameAtEveryDifficulty(
    "a run's opening allocation",
    async (difficulty) => {
      await openRun(h, { difficulty });
      const s = await h.snapshot();
      return {
        charge: s.charge,
        integrity: s.integrity,
        stampsLeft: s.stampsLeft,
        refinement: s.refinement,
      };
    },
  );
  await captureStill(h, "same");
});
