// Automated validation for economy.wave-clear-bonus: clearing a wave pays the flat wave-clear
// bonus in Charge (`8 + 2*wave`, so 10 on Wave 1) and nothing else — banked Charge earns no
// interest.
//
// A non-firing Regulator is kept, so the wave produces NO kill bounties (nothing fires); every
// unit leaks into a Grid Integrity buffer and the wave clears. The only Charge added is the
// wave-clear bonus, so the delta across the clear IS the bonus — and because nothing is killed,
// how many units the wave held never enters the arithmetic. `specs/enemies.md` leaves "the exact
// spawn timing and per-wave mix" to the build, and this check is deliberately built so that it
// does not have to care.
//
// TWO THINGS THIS USED TO GET WRONG.
//
// It asserted `8 + 2*wave` while `specs/gameplay.md` only asked for "a small flat bonus that
// starts at about 10 Charge on Wave 1", attributing the formula to THE REFERENCE BUILD — so the
// check pinned a figure the model was never given, and a build paying 9 or a flat 10 failed for
// implementing what it was told. That is fixed in the spec rather than in the check: the bonus is
// now a stated value like every other number in that file, so asserting it exactly is fair.
//
// And its label claimed "with no interest" while measuring a single clear from a single Charge
// balance — which cannot tell a flat bonus from a bonus plus interest, because both are one
// number. Whether banking is rewarded only becomes visible by clearing the same wave from two
// very different balances. So the clear is run twice, once from the opening reserve and once from
// a hoard of 1000, and both must pay the same. A build paying even 1% on the hoard pays 10 more.
//
// The first clear is the arrange — a wave walking itself out is a minute of Load crossing an
// undefended yard, and this item declares a STILL of the HUD afterwards, not a clip of it, so it
// is skipped rather than filmed. The second clear is the act.

import {
  startBuild,
  placeCandidate,
  skipClearWave,
  waveClearBonus,
  snap,
  TOWER,
  SECOND,
} from "../_helpers.mjs";

// The hoard the second run banks before clearing the same wave. Two orders of magnitude above the
// opening reserve, so any interest worth the name is unmissable in the delta.
const HOARD = 1000;

export default function item() {
  // What each clear paid, and the board the second one left behind.
  let paidFromOpening;
  let paidFromHoard;
  let end;

  // Pose a run with `charge` banked and a non-firing Regulator kept, which launches Wave 1.
  // Returns the Charge reading from immediately before the harvest.
  const armClear = async (api, charge) => {
    await startBuild(api);
    await api.call("setIntegrity", 999);
    if (charge != null) await api.call("setCharge", charge);
    const cand = await placeCandidate(api, "regulator", 1, TOWER.col, TOWER.row); // no kill income
    const before = (await snap(api)).charge;
    await api.call("keep", cand.id); // launches Wave 1
    return before;
  };

  return {
    id: "economy.wave-clear-bonus",

    async arrange(api) {
      // Run one: clear Wave 1 from the opening reserve.
      const before = await armClear(api, null);
      const cleared = await skipClearWave(api, { maxTicks: 300 * SECOND });
      paidFromOpening = cleared.charge - before;

      // Run two: the same wave, cleared from a hoard. Only the clear is left for the act.
      await armClear(api, HOARD);
    },

    async act(api) {
      end = await skipClearWave(api, { maxTicks: 300 * SECOND });
      paidFromHoard = end.charge - HOARD;

      await api.settle(120); // let the HUD paint the new Charge before the still
      await api.screenshot("hud");
    },

    async assert(api, check) {
      check.expectEq("the build phase reopened after the wave cleared", end.phase, "build");

      check.expectEq(
        "clearing Wave 1 paid the flat bonus (8 + 2*1 = 10), with no kill income to muddy it",
        paidFromOpening,
        waveClearBonus(1),
      );

      check.expectEq(
        "the same clear pays the same from a hoard of 1000 Charge (no interest on banked Charge)",
        paidFromHoard,
        paidFromOpening,
      );
    },
  };
}
