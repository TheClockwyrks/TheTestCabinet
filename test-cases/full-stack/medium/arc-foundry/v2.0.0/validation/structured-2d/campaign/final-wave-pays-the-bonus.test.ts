// campaign/final-wave-pays-the-bonus — the last wave pays like any other.
//
// `specs/economy.md` states the rule without an exception: the wave-clear bonus
// "is paid when the wave clears, which is when every unit the wave released has
// died or leaked", and "The wave-clear bonus is a function of the wave number and
// of nothing else." `specs/campaign.md` says the same of the last wave in
// particular: "Clearing it pays the wave-clear bonus. Clearing a wave before wave
// `N` then opens the next build phase, and clearing wave `N` runs the finale
// below instead. The bonus is paid either way."
//
// WHY IT IS PLAYER-VISIBLE, AND SO WHY IT IS A POINT. The finale is not an
// epilogue the player watches: `specs/controls.md` leaves `upgrade` available
// while the Overload Dynamo walks, and `specs/campaign.md` rates the maze on the
// damage it takes. So the last bonus buys one more tower level, and that level
// moves the Maze Rating the run is scored on.
//
// `wave-clear-bonus` reads the general rule over ordinary waves; this reads the
// one wave a build is likely to have wired to the finale instead.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  type Harness,
  openYard,
  releaseUnit,
} from "../harness";
import { difficultyById, waveBonus } from "../constants";

/** The difficulty whose wave count fixes N. */
const DIFFICULTY = "medium";

/** An empty bank, so the bonus is the whole balance afterwards. */
const CHARGE = 0;

/** Frames advanced after the yard empties, for the wave to clear. */
const SETTLE = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("pays wave N's bonus and then runs the finale", async () => {
  const waves = difficultyById(DIFFICULTY).waves;
  openYard(h, { difficulty: DIFFICULTY, wave: waves, charge: CHARGE });

  // One unit is the whole wave, so clearing it is clearing wave N.
  releaseUnit(h, "mote", { frozen: true });
  assertEqual(h.snapshot().wave, waves, "the run stands on its final wave");

  const cleared = await captureReplay(h, "bonus", async () => {
    h.debug.clearUnits();
    await h.advance(SETTLE);
    return h.snapshot();
  });

  assertEqual(
    cleared.charge,
    CHARGE + waveBonus(waves),
    `the Charge after clearing wave ${waves}: its bonus is a function of the ` +
      "wave number and of nothing else (specs/economy.md)",
  );
  assertEqual(
    cleared.phase,
    "finale",
    "the phase clearing the final wave opens (specs/campaign.md)",
  );
});
