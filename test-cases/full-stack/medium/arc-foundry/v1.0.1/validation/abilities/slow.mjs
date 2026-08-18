// Automated validation for abilities.slow: a Choke hit scales the struck unit's speed by
// (1 - amt) for a duration; only its speed changes.
//
// Arming the Choke and releasing the Slug are instant (the arrange); waiting for the hit that
// slows it is the behavior under test, so it is the act and is what the clip shows.

import {
  armTower,
  spawnControlled,
  skipToApproach,
  unitById,
  snap,
  TICK,
  SECOND,
} from "../_helpers.mjs";

// Several Choke cadences (1.3 shots/s), so a build that opens on a full cooldown still lands
// its first hit inside the budget.
const SLOW_TICKS = 4 * SECOND;
// A T1 Choke's slow lasts 1.2 s. Filming most of it is the point of this item's clip: the
// measurement is over the instant the slow lands, but a reviewer can only SEE a slow by
// watching the unit crawl and then pick its pace back up, so the clip runs past the expiry.
const WATCH_TICKS = 2.5 * SECOND;
// One full tick boundary between the hit landing and the measurement, so the derived speed
// is read from a settled state rather than from the tick the slow arrived on.
//
// `slowFactor` and `speed` are two views of the same fact, but nothing makes a build compute
// them at the same moment. A slow is applied on IMPACT, which `specs/towers.md` puts at the
// end of a projectile's travel — and a build that keeps `speed` as a stored field refreshed
// once per tick, when it moves the unit, has not reached that refresh yet when the impact
// lands later in the same tick. Its snapshot then reports the new `slowFactor` beside the
// speed the unit was moving at a moment ago, and one tick later reports both together. That
// ordering is the build's own: the spec fixes what a slow does, not where in a tick a
// derived field is recomputed. Reading on the landing tick pinned it, and failed a build
// whose speed tracks its factor perfectly from the next tick on — reporting an effective
// speed LARGER than the slow allows, which is the opposite of the defect this item hunts.
//
// Two ticks is a settle, not a search: it is spent unconditionally, so a build that never
// folds the slow into the unit's speed still reports the unslowed value and still fails.
// The slow runs 1.2 s (72 ticks) and a Choke's cadence is ~46 ticks, so the pause is far too
// short for the slow to lapse or for a second hit to refresh it.
const SETTLE_TICKS = 2;

export default function item() {
  // The unit `act` follows, whether a slow ever landed, and the state at that instant.
  let unitId;
  let slowed;
  let s;
  let l;

  return {
    id: "abilities.slow",

    async arrange(api) {
      const towerId = await armTower(api, { type: "choke", tier: 1 });
      await api.call("setTargeting", towerId, "strongest"); // keep the Choke on the Slug
      const [u] = await spawnControlled(api, "slug");
      unitId = u.id;
      await skipToApproach(api, towerId, unitId);
    },

    async act(api) {
      // Polled a tick at a time: the instant the slow lands is what is read.
      slowed = await api.until(
        (st) => {
          const live = unitById(st, unitId);
          return live && live.slowFactor < 1;
        },
        { max: SLOW_TICKS, poll: TICK },
      );
      // Let the tick the hit landed on finish before reading what the slow did (SETTLE_TICKS).
      await api.advance(SETTLE_TICKS);
      s = await snap(api);
      l = unitById(s, unitId);

      // The assertions are already fixed on `l`; this only lets the clip run long enough to
      // watch the Slug crawl under the slow.
      await api.advance(WATCH_TICKS);
    },

    async assert(api, check) {
      check.expectOk("the Choke slowed the struck unit", slowed.hit);
      check.expectClose("the slow factor is 1 - slowAmt (T1 Choke = 0.78)", l.slowFactor, 0.78, 0.01);
      check.expectClose("the effective speed is base x slowFactor", l.speed, l.baseSpeed * l.slowFactor, 0.6);
      check.expectGt("the slow has a live duration", l.slowUntil, s.simTime);
    },
  };
}
