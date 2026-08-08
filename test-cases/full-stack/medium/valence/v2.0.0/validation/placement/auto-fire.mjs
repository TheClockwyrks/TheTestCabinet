// Automated validation for the Placement sub-item `auto-fire`.
//
// A built damage tower fires at valid in-range matter with NO manual trigger. The check
// builds an emitter beside the lane and poses a unit in range, then simply runs the
// real sim: the tower acquires the unit and damages it on its own.

import {
  coverAndPassThrough,
  unitById,
  towerById,
  LEAD_TICKS,
  TAIL_TICKS,
} from "../_helpers.mjs";

// How far upstream of the tower's reach the unit starts — about what a 5-electron atom
// covers during the lead-in, so it arrives just as the lead-in ends.
const APPROACH_PX = 90;

export default function item() {
  let unitId;
  let towerId;
  let hp0;
  let r;

  return {
    id: "placement.auto-fire",

    // Posed at the UPSTREAM edge of the tower's range rather than in the middle of it, so
    // the unit travels the whole in-range window. Dropped at the tower's own covering point
    // (what `coverAndSpawn` does) a 5-electron atom is back out of range in about two
    // seconds, and a clip framed to run longer than that spends its tail watching a tower
    // hold fire over an empty lane — which is the opposite of what this item claims.
    async arrange(api) {
      ({ unitId, towerId } = await coverAndPassThrough(api, {
        kind: "emitter",
        type: "atom",
        electrons: 5,
        // Started outside the tower's reach, so the lead-in below is the unit walking in
        // and the whole coverage window is left for the firing this item is about. A
        // lead-in spent INSIDE the window would leave the tail filming an empty lane.
        approachPx: APPROACH_PX,
      }));
      hp0 = unitById(await api.snapshot(), unitId).hp;
    },

    // Nothing is commanded here — the point is that time alone is enough for the tower to
    // acquire and fire, which is exactly what the clip shows.
    //
    // The clip used to BE the sweep: it opened on a tower that had not fired yet and cut on
    // the first frame the unit's hp moved, which for a tower with nothing else to do is a
    // fraction of a second. Framing it (see LEAD_TICKS in _helpers.mjs) gives the reviewer
    // the posed board first — a tower standing over a unit it was never told to shoot — and
    // then keeps filming after the first hit, where the point of the item actually shows:
    // the tower going on firing, unprompted, shot after shot.
    //
    // The lead-in is ordinary simulation time, so the tower is free to fire during it; the
    // sweep below then returns on its first sample, and the verdict is the same either way.
    async act(api) {
      await api.advance(LEAD_TICKS);
      // 180 ticks = the old 3 s cap; poll 6 = the old 0.1 s chunk.
      r = await api.until(
        (s) => {
          const u = unitById(s, unitId);
          return u != null && u.hp < hp0;
        },
        { max: 180, poll: 6 },
      );
      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectOk("the tower fires unprompted and damages the unit", r.hit);
      check.expectOk(
        "the tower acquired the in-range unit as its target",
        towerById(r.snap, towerId).targetId != null,
      );
    },
  };
}
