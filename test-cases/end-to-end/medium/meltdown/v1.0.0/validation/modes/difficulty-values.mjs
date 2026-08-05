// Automated validation for the Modes sub-item `difficulty-values`.
//
// Containment Easy, Medium, and Hard change the starting money and the number of
// waves (specs/modes.md — Easy 350/15, Medium 250/20, Hard 200/26). We start each and
// read its money and wave count.
//
// ONE STILL PER DIFFICULTY. The old single screenshot was taken after the loop had run,
// so it showed the LAST difficulty started and nothing else — one balance and one wave
// count, with no way for a reviewer to tell 200/26 from a build that opens every
// difficulty the same way. Since the claim is that the three differ, the evidence has to
// be the three of them: each is captured as it is started, so the stills sit side by
// side in the review and the readouts can simply be compared.

import { newGame, restartGame } from "../_helpers.mjs";

const EXPECTED = {
  easy: { money: 350, waves: 15 },
  medium: { money: 250, waves: 20 },
  hard: { money: 200, waves: 26 },
};

const DIFFICULTIES = Object.keys(EXPECTED);

export default function item() {
  const got = {};

  return {
    id: "modes.difficulty-values",

    // The first difficulty is started here, where `newGame` (and its `reset`) is
    // legal. Its still is captured in `act` with the others, so the three frames are
    // taken the same way.
    async arrange(api) {
      const s = await newGame(api, "containment", DIFFICULTIES[0]);
      got[DIFFICULTIES[0]] = { money: s.money, waves: s.waveCount };
    },

    // Capture the first, then start and capture each of the others. A fresh match
    // started from `act` must not `reset` — that would hand the clock back and freeze
    // the recording — so `restartGame` re-poses the whole match through the same real
    // start path without touching the clock.
    async act(api) {
      await api.settle(120);
      await api.screenshot(DIFFICULTIES[0]);

      for (const diff of DIFFICULTIES.slice(1)) {
        const s = await restartGame(api, "containment", diff);
        got[diff] = { money: s.money, waves: s.waveCount };
        await api.settle(120);
        await api.screenshot(diff);
      }
    },

    async assert(api, check) {
      for (const diff of DIFFICULTIES) {
        check.expectEq(
          `${diff} starting money`,
          got[diff].money,
          EXPECTED[diff].money,
        );
        check.expectEq(
          `${diff} wave count`,
          got[diff].waves,
          EXPECTED[diff].waves,
        );
      }
    },
  };
}
