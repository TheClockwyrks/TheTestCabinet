// refinement/refinement-midwave — the press refines while the Load is on the yard.
//
// specs/scrap-press.md fixes when refining is available: "Combining standing
// components, refining the press, and upgrading a combination tower are available
// in every phase, including during a live wave", and again under Refinement,
// "Refining is available in every phase, including during a live wave".
// specs/campaign.md lists it among the things that "stay available" while building
// is not, and specs/controls.md puts `upgrade` in every phase "including during a
// wave and the finale".
//
// The wave is opened through `spawnUnit`, which "puts the run into a live wave
// whose spawn schedule is empty" (specs/instrumentation.md), so the yard holds one
// held unit and nothing else: no composed wave walking through the reading, no
// kill paying a bounty into the bank being measured, and no clear ending the phase
// under the check. What is read is the level rising, the exact price leaving the
// bank, and the wave carrying on either side of it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { refinementCost } from "../constants";
import {
  captureReplay,
  createHarness,
  holdWaveOpen,
  openYard,
  type Harness,
} from "../harness";

/** The wave the run is posed at, so an unchanged counter is a visible figure. */
const WAVE = 4;

/** Enough to buy the first rung and leave a remainder that is not zero. */
const BANK = 100;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refines during a live wave, spends the price, and leaves the wave running", async () => {
  await openYard(h, { wave: WAVE, charge: BANK, refinement: 0 });
  await holdWaveOpen(h);

  const before = await h.snapshot();
  assertEqual(before.phase, "wave", "the phase the refinement is bought in");
  assertEqual(before.charge, BANK, "the bank before the refinement");

  const after = await captureReplay(h, "midwave", async () => {
    await h.debug.upgradeQuality();
    await h.advanceSeconds(1);
    return h.snapshot();
  });

  assertEqual(after.refinement, 1, "the level after refining mid-wave");
  assertEqual(
    after.charge,
    BANK - refinementCost(1),
    `the bank after paying ${refinementCost(1)} for R1 mid-wave`,
  );
  assertEqual(after.phase, "wave", "the phase after refining mid-wave");
  assertEqual(after.wave, WAVE, "the wave number after refining mid-wave");
  assertEqual(after.waveActive, true, "the wave still running after refining");
});
