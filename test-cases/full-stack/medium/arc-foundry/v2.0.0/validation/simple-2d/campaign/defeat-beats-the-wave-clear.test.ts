// campaign/defeat-beats-the-wave-clear — the last leak ends the run, not the wave.
//
// One advance can satisfy two rules at once. specs/campaign.md: a wave "is
// cleared when every unit it released has died or leaked", and clearing it "pays
// the wave-clear bonus". The same file's outcome table: "Defeat — Grid Integrity
// reaches `0`, at any point, including mid-wave. The defeat screen, immediately."
// When the wave's last unit is the leak that empties the grid, both descriptions
// fit the same advance, and only one of them can be the outcome.
//
// specs/economy.md settles it by saying when defeat lands rather than what it
// competes with: reaching zero "ends the run in defeat immediately". A run that
// has ended is not playing a wave, so there is no clear to pay for. The bonus is
// what makes the difference readable: specs/economy.md fixes it as
// `WAVE_BONUS_BASE + WAVE_BONUS_STEP * n`, so a build that clears the wave first
// hands the player Charge on the advance that ended their run.
//
// THE YARD IS EMPTY BUT FOR THE LEAK. `spawnUnit` opens a wave whose schedule is
// empty, so the one Mote released here is the whole wave: it grounds out, the
// wave has nothing left, and the two rules meet on that advance.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  openYard,
  waveBonus,
  type Harness,
} from "../harness";
import { leakOne } from "./runs";

/** The wave the run is on, so the bonus a wrong build pays is a figure worth reading. */
const WAVE = 4;

/** One short of the end: a Mote's leak of `1` takes the counter to `0`. */
const INTEGRITY = 1;

/** What the bank holds, so anything the clear paid shows up as the whole balance. */
const CHARGE = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("ends the run rather than paying the clear that the same leak completes", async () => {
  openYard(h, { wave: WAVE, integrity: INTEGRITY, charge: CHARGE });

  const defeated = await captureReplay(h, "overload", () => leakOne(h, "mote"));

  assertLessThanOrEqual(
    defeated.integrity,
    0,
    "the leak took Grid Integrity to zero",
  );
  assertEqual(
    defeated.screen,
    "overload",
    "the run ends in defeat on the advance the counter empties",
  );
  assertEqual(
    defeated.charge,
    CHARGE,
    `no wave-clear bonus of ${waveBonus(WAVE)} was paid, because the run ended ` +
      "on that advance rather than clearing a wave",
  );
});
