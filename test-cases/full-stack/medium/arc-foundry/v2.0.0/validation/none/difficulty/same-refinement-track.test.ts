// difficulty/same-refinement-track — the refinement track, its odds and
// its costs are the same at every difficulty.
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
// HOW IT IS DECIDED. At each difficulty the press is walked up every rung of the
// track, the five-tier odds are read at each, and each rung is then bought
// through the press's own refinement control so the Charge it took is read off
// the bank. The three difficulties' readings are held against each other.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { REFINEMENT_MAX } from "../constants";
import { captureStill, createHarness, openRun, type Harness } from "../harness";
import { sameAtEveryDifficulty } from "./same";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries the same refinement track, odds and costs at every difficulty", async () => {
  await sameAtEveryDifficulty("the refinement track", async (difficulty) => {
    await openRun(h, { difficulty });

    // The odds at every rung of the track.
    const odds: number[][] = [];
    for (let level = 0; level <= REFINEMENT_MAX; level += 1) {
      await h.debug.setRefinement(level);
      odds.push((await h.snapshot()).qualityOdds);
    }

    // And what each rung costs, taken off the bank the press's own refinement
    // control spends from.
    const costs: number[] = [];
    for (let level = 1; level <= REFINEMENT_MAX; level += 1) {
      await h.debug.setRefinement(level - 1);
      await h.debug.setCharge(10_000);
      await h.debug.upgradeQuality();
      const s = await h.snapshot();
      assertEqual(
        s.refinement,
        level,
        `refining the press from R${level - 1} to reach R${level} ` +
          "(specs/scrap-press.md)",
      );
      costs.push(10_000 - s.charge);
    }

    await captureStill(h, "track");
    return { odds, costs };
  });
});
