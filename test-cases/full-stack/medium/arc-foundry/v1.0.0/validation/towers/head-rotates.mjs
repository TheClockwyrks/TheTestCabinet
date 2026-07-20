// Automated validation for towers.head-rotates: a firing component's head rotates to point at
// the target it is firing at.
//
// A tower is armed and a unit released; after a moment the head's heading must point at the
// unit (within a small tolerance).
//
// Arming and releasing are control ops (the arrange); the moment the head takes to swing onto
// the target is the behavior under test and is the act.

import { armTower, spawnControlled, towerById, unitById, angleTo, angDiff, snap, SECOND } from "../_helpers.mjs";

// 0.05 s = 3 ticks exactly — long enough for the head to acquire and aim.
const AIM_TICKS = 0.05 * SECOND;

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
      [u] = await spawnControlled(api, "slug");
    },

    async act(api) {
      await api.advance(AIM_TICKS); // let the head acquire and aim

      const s = await snap(api);
      t = towerById(s, towerId);
      live = unitById(s, u.id);
    },

    async assert(api, check) {
      const expected = angleTo(t.cx, t.cy, live);
      check.expectLt("the head points at the target it is firing at", angDiff(t.heading, expected), 0.2);
    },
  };
}
