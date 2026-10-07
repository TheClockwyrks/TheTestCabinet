// difficulty/same-refinement-track — the refinement track, its odds and its costs
// are the same at every difficulty.
//
// `specs/difficulty.md` names them among the values "identical at every
// difficulty": "the refinement track and its costs". So every rung's roll odds and
// every rung's price are read off the running game at each of the three and held
// against each other.
//
// The cost is taken off the bank the press's own refinement control spends from,
// rather than off a table, so what is compared is what refining actually costs a
// player at that difficulty. What those numbers ARE is decided by the scrap-press
// checklist.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { REFINEMENT_MAX } from "../constants";
import { captureStill, createHarness, openRun, type Harness } from "../harness";
import { sameAtEveryDifficulty } from "./same";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("carries the same refinement track, odds and costs at every difficulty", async () => {
  await sameAtEveryDifficulty("the refinement track", async (difficulty) => {
    openRun(h, { difficulty });

    // The odds at every rung of the track.
    const odds: number[][] = [];
    for (let level = 0; level <= REFINEMENT_MAX; level += 1) {
      h.debug.setRefinement(level);
      odds.push(h.snapshot().qualityOdds);
    }

    // And what each rung costs, taken off the bank the press's own refinement
    // control spends from.
    const costs: number[] = [];
    for (let level = 1; level <= REFINEMENT_MAX; level += 1) {
      h.debug.setRefinement(level - 1);
      h.debug.setCharge(10_000);
      h.debug.upgradeQuality();
      const s = h.snapshot();
      assertEqual(
        s.refinement,
        level,
        `refining the press from R${level - 1} to reach R${level} ` +
          "(specs/scrap-press.md)",
      );
      costs.push(10_000 - s.charge);
    }

    return { odds, costs };
  });
  // The last of the three readings, drawn: the yard the comparison ended on.
  await h.advance(1);
  captureStill(h, "track");
});
