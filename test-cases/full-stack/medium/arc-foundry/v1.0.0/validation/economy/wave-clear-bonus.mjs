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
// WHAT IS FILMED. The item's evidence used to be a still of the HUD once everything was over,
// which is a picture of a Charge total and nothing else: the number a reviewer is looking at is
// the bonus plus whatever was there before, and the still cannot separate them or show a wave
// clearing at all. The payment is an EVENT, so the evidence has to be the event.
//
// Both waves are still skipped for almost all of their length — a wave walking itself out is a
// minute of Load crossing an undefended yard, which is the journey to the evidence rather than
// the evidence. The second one is skipped up to the point where its LAST unit is on the
// Collector's doorstep, and the act is the few seconds either side of that: the last of the Load
// grounding out, the floor emptying, and the Charge counter stepping up by the bonus. That is the
// whole sentence, filmed.

import {
  startBuild,
  placeCandidate,
  skipClearWave,
  waveClearBonus,
  snap,
  tileCenter,
  TOWER,
  SECOND,
} from "../_helpers.mjs";

// The hoard the second run banks before clearing the same wave. Two orders of magnitude above the
// opening reserve, so any interest worth the name is unmissable in the delta.
const HOARD = 1000;
// How close to the Collector the last unit must be before filming starts, in px. Far enough that
// the clip opens on it still walking, close enough that it arrives within a beat.
const DOORSTEP = 140;
// How long the act waits for that arrival and the phase flip, and how long it holds on the paid
// HUD afterwards.
const CLEAR_TICKS = 6 * SECOND;
const TAIL_TICKS = 2 * SECOND;

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

      // Run two: the same wave, cleared from a hoard.
      await armClear(api, HOARD);
      // Skip the crossing and stop with the wave down to its last unit, on the Collector's
      // doorstep — so the act opens a beat before the clear rather than a minute before it.
      //
      // The wave has to have POPULATED before "one unit left" means the last one: a wave releases
      // its Load over time, so a floor holding a single unit is also what the opening moments look
      // like. `seen` is what tells those apart.
      let seen = false;
      await api.skipUntil(
        (s) => {
          if (s.phase !== "wave") return true; // it cleared already — nothing left to film
          if (s.units.length >= 1) seen = true;
          if (!seen || s.units.length !== 1) return false;
          const last = s.units[0];
          const sink = tileCenter(s.collector.col, s.collector.row);
          return Math.hypot(last.x - sink.x, last.y - sink.y) <= DOORSTEP;
        },
        { max: 300 * SECOND, poll: 5 },
      );
    },

    async act(api) {
      // The last of the Load grounding out, the floor emptying, and the bonus landing.
      await api.until((s) => s.phase === "build" || s.screen !== "playing", {
        max: CLEAR_TICKS,
        poll: 5,
      });
      end = await snap(api);
      paidFromHoard = end.charge - HOARD;

      await api.advance(TAIL_TICKS); // hold on the paid HUD and the reopened build phase
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
