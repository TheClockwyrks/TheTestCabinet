// Automated validation for towers.head-rotates: a firing component's head rotates to point at
// the target it is firing at.
//
// A tower is armed and a unit released; after a moment the head's heading must point at the
// unit (within a small tolerance).
//
// Arming and releasing are control ops (the arrange); the moment the head takes to swing onto
// the target is the behavior under test and is the act.

import {
  armTower,
  spawnControlled,
  skipToApproach,
  towerById,
  unitById,
  angleTo,
  angDiff,
  snap,
  TICK,
  SECOND,
} from "../_helpers.mjs";

// How long to wait for the closing unit to come into reach and the head to swing onto it.
const ACQUIRE_TICKS = 3 * SECOND;
// Then keep filming while the unit walks on past, so the clip shows the head TRACKING it
// rather than a single frozen bearing.
const TRACK_TICKS = 2.5 * SECOND;

export default function item() {
  // The tower and unit followed, and how they stood once the head had aimed.
  let towerId;
  let u;
  let t;
  let live;

  return {
    id: "towers.head-rotates",

    async arrange(api) {
      towerId = await armTower(api, { type: "capacitor", tier: 1 });
      await api.call("setTargeting", towerId, "strongest");
      [u] = await spawnControlled(api, "slug");
      await skipToApproach(api, towerId, u.id);
    },

    async act(api) {
      // The unit is a beat OUTSIDE the tower's reach when the clip opens, and a head with
      // nothing in range has nothing to point at — so wait for it to actually come into reach
      // rather than for a fixed number of ticks, then read the bearing.
      await api.until(
        (s) => {
          const t0 = towerById(s, towerId);
          const l0 = unitById(s, u.id);
          return (
            !!t0 && !!l0 && Math.hypot(l0.x - t0.cx, l0.y - t0.cy) <= t0.range
          );
        },
        { max: ACQUIRE_TICKS, poll: TICK },
      );
      await api.advance(2); // the head swings onto it

      const s = await snap(api);
      t = towerById(s, towerId);
      live = unitById(s, u.id);

      await api.advance(TRACK_TICKS);
    },

    async assert(api, check) {
      const expected = angleTo(t.cx, t.cy, live);
      check.expectLt("the head points at the target it is firing at", angDiff(t.heading, expected), 0.2);
    },
  };
}
