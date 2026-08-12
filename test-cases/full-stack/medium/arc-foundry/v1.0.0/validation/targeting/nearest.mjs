// Automated validation for targeting.nearest: under `nearest` a firing component aims at the
// unit closest to it in straight-line distance.
//
// WHY THIS ITEM HAS ITS OWN POSE. It used to share `arrangeHeadTargets` with `first` and `last`,
// which walks two units up a corridor the tower sits beside and stops them as they arrive. In
// that pose the leading unit is further along the chain AND nearer the tower for the whole
// measurement, so `nearest` and `first` name the same unit — and the check, which compares the
// head's bearing against whichever unit is actually nearer, was satisfied by a tower implementing
// either one. A run implementation that visibly shot the furthest-along unit under `nearest`
// passed this item.
//
// `arrangeNearestTargets` pulls the two apart: it walks the pair on until the leader has passed
// the tower's column, from where every further step takes it AWAY, leaving the trailing unit the
// nearer of the two while still being the one less far along. `nearest` and `first` then name
// different units and the check can tell them apart — which the second assertion below states
// explicitly, so a pose that ever collapsed back into the degenerate one fails rather than
// quietly passing everything.
//
// `arrangeNearestTargets` is the arrange; `actHeadTargets` is the act, because the choice the
// head makes once it has both units in reach is the behavior under test and is the clip.

import { arrangeNearestTargets, actHeadTargets, angleTo, angDiff } from "../_helpers.mjs";

export default function item() {
  // The ids the act needs, and the pose it produced.
  let ctx;
  let posed;

  return {
    id: "targeting.nearest",

    async arrange(api) {
      ctx = await arrangeNearestTargets(api);
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

      // The pose is only worth grading if the nearer unit is NOT also the furthest along: those
      // are the two things `nearest` and `first` order by, and while they agree no bearing can
      // tell which priority produced it. `la` is the leader — released first, so further along.
      check.expectOk(
        "the nearer unit is the one LESS far along, so nearest and first differ here",
        nearer !== la,
      );
      check.expectLt(
        "under nearest, the head aims at the closer unit",
        angDiff(t.heading, angleTo(t.cx, t.cy, nearer)),
        angDiff(t.heading, angleTo(t.cx, t.cy, farther)),
      );
    },
  };
}
