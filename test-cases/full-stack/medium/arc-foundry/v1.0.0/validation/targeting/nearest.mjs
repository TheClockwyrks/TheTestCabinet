// Automated validation for targeting.nearest: under `nearest` a firing component aims at the
// unit closest to it in straight-line distance.
//
// The advanced unit has moved along the leg and is nearer the corridor tower than the
// fresh unit at the Entry, so under `nearest` the head must aim at the advanced (nearer) one.
//
// The pose is split across the seam: `arrangeHeadTargets` arms the Emitter and releases the
// first unit (instant), and `actHeadTargets` is the act, because the DISTANCE difference this
// item turns on only exists once game time has let the first unit walk.

import { arrangeHeadTargets, actHeadTargets, angleTo, angDiff } from "../_helpers.mjs";

export default function item() {
  // The ids the act needs, and the pose it produced.
  let ctx;
  let posed;

  return {
    id: "targeting.nearest",

    async arrange(api) {
      ctx = await arrangeHeadTargets(api, "nearest");
    },

    async act(api) {
      posed = await actHeadTargets(api, ctx);
    },

    async assert(api, check) {
      const { t, la, lb } = posed;
      const dA = Math.hypot(la.x - t.cx, la.y - t.cy);
      const dB = Math.hypot(lb.x - t.cx, lb.y - t.cy);
      const nearer = dA <= dB ? la : lb;
      const farther = dA <= dB ? lb : la;
      check.expectLt(
        "under nearest, the head aims at the closer unit",
        angDiff(t.heading, angleTo(t.cx, t.cy, nearer)),
        angDiff(t.heading, angleTo(t.cx, t.cy, farther)),
      );
    },
  };
}
