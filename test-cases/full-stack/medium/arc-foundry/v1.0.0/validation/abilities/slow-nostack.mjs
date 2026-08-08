// Automated validation for abilities.slow-nostack: repeated slows on one unit do not compound
// — the effective slow stays the strongest single value (refreshed on hit), never the product.
//
// A single Choke hits the same Slug repeatedly. The slow factor is read the instant the FIRST hit
// lands, and again after several more have landed on top of it; the two must be the same. Slows
// compound by MULTIPLYING, so a build that stacks them drives the factor DOWN (0.78 x 0.78 is
// ~0.61) — which is what this looks for.
//
// WHAT THIS MEASURES, AND WHAT IT DELIBERATELY DOES NOT. It used to assert the absolute figure —
// the factor must be 0.78, the Scrap Choke's `1 - slowAmt`. That is a true requirement, but it is
// `abilities/slow`'s requirement: that item exists to check the slow is derived correctly.
// Asserting it here too meant one defect failed two review items — a build whose slowAmt is wrong
// fails `slow` for the wrong value and fails `slow-nostack` for the same wrong value, having
// implemented non-stacking perfectly. Measured against a run implementation reporting 0.68 where
// the table says 0.78, that is exactly what happened, and the item said nothing at all about
// whether repeated slows compound.
//
// So this item now measures the invariant it is named for and nothing else: whatever value the
// build slows to, further hits must not deepen it. A build with the wrong slowAmt still fails
// `abilities/slow`; a build that COMPOUNDS its slows fails this one, which is the only item that
// can catch it.
//
// WHY THIS IS A CLIP RATHER THAN A STILL. The claim is that a value does NOT move across a run
// of hits. A still is one reading of it, which a reviewer has nothing to compare against — a
// frame showing a slowed Slug is equally what a build that compounds its slows produces, one hit
// earlier. The evidence has to carry the run: the Slug under repeated fire, visibly slowed, and
// visibly no MORE slowed at the end of it than after the first hit.
//
// Arming the Choke and releasing the Slug are control ops (the arrange); the two seconds of
// repeated hits is the behavior under test, so it is the act and is what gets filmed.

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

// How long to wait for the first hit to land a slow, the run of further hits piled on top of it,
// and the beat after the reading that shows the slow holding steady.
const LAND_TICKS = 4 * SECOND;
const HITS_TICKS = 2 * SECOND;
const TAIL_TICKS = 2.5 * SECOND;

export default function item() {
  // The unit followed, its slow as first applied, and its slow after further hits.
  let unitId;
  let firstFactor;
  let l;

  return {
    id: "abilities.slow-nostack",

    async arrange(api) {
      const towerId = await armTower(api, { type: "choke", tier: 1 });
      await api.call("setTargeting", towerId, "strongest"); // the Slug is the only unit, but pin it anyway
      const [u] = await spawnControlled(api, "slug");
      unitId = u.id;
      // Walk the Slug up to the tower's reach first; the run of hits below is what is measured,
      // and it cannot begin until the Slug is actually under fire.
      await skipToApproach(api, towerId, unitId);
    },

    async act(api) {
      // The first slow: read the instant it lands, so the baseline is one hit's worth and not
      // whatever several hits have already made of it.
      const hit = await api.until((s) => (unitById(s, unitId)?.slowFactor ?? 1) < 1, {
        max: LAND_TICKS,
        poll: TICK,
      });
      firstFactor = unitById(hit.snap, unitId)?.slowFactor ?? 1;
      if (firstFactor >= 1) {
        // Nothing was ever slowed, so there is no stacking behavior to observe. Whether a Choke
        // slows at all is `abilities/slow`'s subject, and one defect failing one item is the
        // right blast radius.
        throw unmetPrecondition(
          "the Choke never slowed the Slug, so there was no slow to pile further hits onto",
        );
      }

      await api.advance(HITS_TICKS); // several more Choke hits (cadence ~0.77 s)
      l = unitById(await snap(api), unitId);

      // Carry on under fire, so the clip shows the slow holding rather than cutting on the
      // reading. A compounding build keeps dragging the Slug slower across this tail; a
      // conformant one walks at the same pace it did after the first hit.
      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectOk("the Slug is still alive to read", !!l);
      check.expectClose(
        "repeated slows do not compound (the factor stays at the single strongest value)",
        l.slowFactor,
        firstFactor,
        0.02,
      );
      check.expectGe(
        "...so the slow was never driven deeper than one hit lands it",
        l.slowFactor,
        firstFactor * 0.98,
      );
    },
  };
}
