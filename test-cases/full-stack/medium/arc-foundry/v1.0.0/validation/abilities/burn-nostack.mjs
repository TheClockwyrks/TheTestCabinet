// Automated validation for abilities.burn-nostack: repeated burns on one unit do not add up —
// the burn damage-per-second stays the strongest single value (refreshed on hit), not the sum.
//
// A single Rectifier hits the same Slug repeatedly. `burnDps` is read the instant the FIRST burn
// lights, and again after several more hits have landed on top of it; the two must be the same.
//
// WHAT THIS MEASURES, AND WHAT IT DELIBERATELY DOES NOT. It used to assert the absolute figure —
// `burnDps` must be 1, the Scrap Rectifier's `shotDamage x burnFrac`. That is a true requirement,
// but it is `abilities/burn`'s requirement: that item exists to check the burn is derived
// correctly. Asserting it here too meant one defect failed two review items — a build whose
// burnFrac is wrong fails `burn` for the wrong value and fails `burn-nostack` for the same wrong
// value, having implemented non-stacking perfectly. Measured against a run implementation that
// reported 0.7 where the table says 1, that is exactly what happened, and the item said nothing
// at all about whether repeated burns compound.
//
// So this item now measures the invariant it is named for and nothing else: whatever value the
// build lights the burn at, a second and third hit must not raise it. A build with the wrong
// burnFrac still fails `abilities/burn`; a build that SUMS its burns fails this one, which is the
// only item that can catch it. The only absolute claim kept here is that a burn lights at all,
// without which there is nothing to watch for stacking.
//
// Arming the tower and releasing the Slug are control ops (the arrange); the run of repeated hits
// is the behavior under test, so it is the act and is what gets filmed.

import {
  armTower,
  spawnControlled,
  skipToApproach,
  unitById,
  unmetPrecondition,
  snap,
  TICK,
  SECOND,
} from "../_helpers.mjs";

// How long to wait for the first hit to light a burn, and how many more hits to pile on after it.
// A Scrap Rectifier's cadence is ~0.9 s, so two and a half seconds is a good two or three further
// hits — every one of them landing on a burn that is already running.
const LIGHT_TICKS = 4 * SECOND;
const PILE_TICKS = 2.5 * SECOND;
// A beat after the reading, so the clip carries the burn ticking at a steady rate rather than
// cutting on the measurement.
const TAIL_TICKS = 2 * SECOND;

export default function item() {
  // The unit followed, its burn as first lit, and its burn after further hits.
  let unitId;
  let firstDps;
  let l;

  return {
    id: "abilities.burn-nostack",

    async arrange(api) {
      const towerId = await armTower(api, { type: "rectifier", tier: 1 });
      await api.call("setTargeting", towerId, "strongest");
      const [u] = await spawnControlled(api, "slug");
      unitId = u.id;
      // Walk the Slug up to the tower's reach first; the run of hits below is what is measured,
      // and it cannot begin until the Slug is actually under fire.
      await skipToApproach(api, towerId, unitId);
    },

    async act(api) {
      // The first burn: read the instant it lights, so the baseline is one hit's worth and not
      // whatever several hits have already made of it.
      const lit = await api.until((s) => (unitById(s, unitId)?.burnDps ?? 0) > 0, {
        max: LIGHT_TICKS,
        poll: TICK,
      });
      firstDps = unitById(lit.snap, unitId)?.burnDps ?? 0;
      if (!firstDps) {
        // No burn ever lit, so there is no stacking behavior to observe. Whether a Rectifier
        // burns at all is `abilities/burn`'s subject, and one defect failing one item is the
        // right blast radius.
        throw unmetPrecondition(
          "the Rectifier never lit a burn on the Slug, so there was no burn to pile hits onto",
        );
      }

      // Then pile further hits onto the running burn.
      await api.advance(PILE_TICKS);
      l = unitById(await snap(api), unitId);

      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectOk("the Slug is still alive to read", !!l);
      check.expectClose(
        "repeated burns keep the strongest single DPS, not the sum",
        l.burnDps,
        firstDps,
        Math.max(0.02, firstDps * 0.05),
      );
      check.expectLe(
        "...so the burn never climbed above what one hit lights",
        l.burnDps,
        firstDps * 1.05,
      );
    },
  };
}
