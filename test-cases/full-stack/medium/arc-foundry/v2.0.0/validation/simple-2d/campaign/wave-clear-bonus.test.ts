// campaign/wave-clear-bonus — clearing wave n pays its flat bonus.
//
// specs/economy.md's income table: "Wave-clear bonus — `WAVE_BONUS_BASE +
// WAVE_BONUS_STEP * waveNumber`, with `WAVE_BONUS_BASE` (`8`) and
// `WAVE_BONUS_STEP` (`2`). Wave `1` therefore pays `10`." It "is paid when the
// wave clears, which is when every unit the wave released has died or leaked."
//
// Three waves are launched and cleared, and the Charge the clear paid is read as
// the difference across it. The three are spread along the run — `1`, `6` and
// `20` — because the rule is a line in the wave number and a build carrying a
// flat bonus, or one stepping by the wrong amount, agrees with the line at one
// point and parts from it at the others.
//
// NOTHING ELSE PAYS INTO THE COUNTER. Charge has one other income, a kill's
// bounty, and the waves here are emptied through `clearUnits`, which kills
// nothing and leaks nothing, so no bounty is ever paid; the harvest that
// launches each wave leaves a Regulator standing, which never fires. The two
// sinks, refining and upgrading, are never touched. What crosses the counter is
// the bonus.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { WAVE_BONUS_BASE, WAVE_BONUS_STEP, waveBonus } from "../constants";
import { captureReplay, type Harness, openYard } from "../harness";
import { clearWave, createRunHarness, harvestWave } from "./runs";

/** The waves whose clears are read: the first, an early one, and a deep one. */
const SAMPLE = [1, 6, 20];

let h: Harness;

beforeEach(async () => {
  h = await createRunHarness();
});

afterEach(() => {
  h.dispose();
});

it("pays WAVE_BONUS_BASE + WAVE_BONUS_STEP * n as wave n clears", async () => {
  const paid = await captureReplay(h, "bonus", async () => {
    const rows: number[] = [];
    for (const wave of SAMPLE) {
      openYard(h, { wave: wave - 1, charge: 0 });
      harvestWave(h, wave);
      const before = h.snapshot().charge;
      const cleared = await clearWave(h);
      assertEqual(
        cleared.snapshot.phase,
        "build",
        `wave ${wave} cleared into a build phase`,
      );
      rows.push(cleared.snapshot.charge - before);
    }
    return rows;
  });

  for (const [index, wave] of SAMPLE.entries()) {
    assertEqual(
      paid[index],
      waveBonus(wave),
      `clearing wave ${wave} pays ${WAVE_BONUS_BASE} + ` +
        `${WAVE_BONUS_STEP} * ${wave}`,
    );
  }
});
