// Automated validation for the FX sub-item `bondsnap`.
//
// A produced particle burst fires when a bond snaps and a free atom is shed from a cluster
// (specs/assets.md: "Bond-snap shards, a scatter of shards when a bonded cluster's bond pool
// is chipped and it sheds an atom"). The check chips a Polymer with a Cleaver and runs on
// until a "bondsnap" burst appears in the live effects list.
//
// Two things about the set-up are load-bearing, and without them the item failed builds that
// fire the burst correctly:
//
//   * the Cleaver is pointed at the LAST unit in range. A cluster sheds its freed atoms just
//     AHEAD of itself (specs/board.md: a fragmenting unit "spawns its fragments on the same
//     path at its own position"), so a tower left on the default FIRST priority abandons the
//     cluster for its own first fragment and the pool stops draining — no further snap, and
//     on a build whose burst comes as the pool breaks, no burst at all.
//   * the Polymer is posed at the UPSTREAM edge of the tower's range (coverAndPassThrough)
//     rather than at its centre, so it travels the whole in-range window. Posed at the centre
//     it gets only the forward half of it — barely two shots of a 1.2/s Cleaver against an
//     11-point pool.
//
// The clip then runs on past the burst, so the shards actually play out and the shed atom
// pulls away from its parent, instead of the recording cutting on the frame the burst first
// appeared.

import {
  coverAndPassThrough,
  focusOnParent,
  clipBudget,
  LEAD_TICKS,
  TICK,
} from "../_helpers.mjs";

const MAX_SNAP_TICKS = 600;

const TAIL_TICKS = 120; // 2 s of aftermath, so the burst and the shed atom read

export default function item() {
  let r;

  return {
    id: "fx.bondsnap",

    // Without a budget of its own the 10 s sweep above outran the runtime's 8 s default and
    // the record pass stopped before the snap it was waiting for.
    clipMs: clipBudget(LEAD_TICKS + MAX_SNAP_TICKS + TAIL_TICKS),

    async arrange(api) {
      await coverAndPassThrough(api, { kind: "cleaver", type: "polymer" });
      await focusOnParent(api);
    },

    // The Cleaver chipping the cluster until a bond snaps — which is both the check and
    // the burst the reviewer is being shown.
    async act(api) {
      // The cluster travelling in with its pool intact.
      await api.advance(LEAD_TICKS);
      // 600 ticks = 10 s of game time, comfortably the whole coverage window a Polymer
      // takes to cross at 40 px/s. Polled every TICK: a burst is short-lived and must not
      // be polled past.
      r = await api.until((s) => s.effects.some((e) => e.kind === "bondsnap"), {
        max: MAX_SNAP_TICKS,
        poll: TICK,
      });
      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectOk("a bond-snap burst fires when an atom is shed", r.hit);
    },
  };
}
