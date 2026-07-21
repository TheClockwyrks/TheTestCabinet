// Automated validation for targeting.first: a firing component defaults to `first` and, under
// it, aims at the unit furthest along the waypoint chain.
//
// The default priority is read off a freshly-armed component. Then two units are posed — one
// advanced (further along), one fresh — and the head, under `first`, must aim at the advanced
// one (closer in angle to it than to the fresh one).
//
// Both halves of the arrange reset the run, which only `arrange` may do, and neither consumes
// game time: the default-priority read comes off a capacitor armed and read on the spot, and
// `arrangeHeadTargets` then re-opens the run with the Emitter and releases the first unit. The
// act is `actHeadTargets`, which is where the two units come to differ — it needs game time to
// pass BETWEEN the two spawns, and that gap is the whole scenario.

import { armTower, towerById, snap, arrangeHeadTargets, actHeadTargets, angleTo, angDiff } from "../_helpers.mjs";

export default function item() {
  // The default priority read off a fresh component, the ids the act needs, and the pose it
  // produced.
  let defaultTargeting;
  let ctx;
  let posed;

  return {
    id: "targeting.first",

    async arrange(api) {
      const id = await armTower(api, { type: "capacitor", tier: 1 });
      defaultTargeting = towerById(await snap(api), id).targeting;

      ctx = await arrangeHeadTargets(api);
    },

    async act(api) {
      posed = await actHeadTargets(api, ctx, "first");
    },

    async assert(api, check) {
      check.expectEq("a firing component defaults to the first priority", defaultTargeting, "first");

      const { t, la, lb } = posed;
      const toAdvanced = angDiff(t.heading, angleTo(t.cx, t.cy, la));
      const toFresh = angDiff(t.heading, angleTo(t.cx, t.cy, lb));
      check.expectLt("under first, the head aims at the unit furthest along (not the fresh one)", toAdvanced, toFresh);
      check.expectLt("...and closely tracks it", toAdvanced, 0.25);
    },
  };
}
