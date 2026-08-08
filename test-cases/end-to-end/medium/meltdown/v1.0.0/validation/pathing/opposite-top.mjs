// Automated validation for the Pathing sub-item `opposite-top`.
//
// A unit entering the top vent is assigned the bottom (opposite) exhaust and leaves
// there, never the nearer one (specs/playfield.md). We spawn a real Mote at the top
// vent, read its assigned exhaust, and drive it down to the bottom edge.
//
// As with `opposite-left`, arriving is not the whole claim. With nothing built there
// is nothing to route around — the maze is what bends a path (specs/playfield.md) — so
// the descent from the top vent to the bottom exhaust is a straight drop down the
// lane. The drive therefore also watches the cross-axis, here `x`: a build that swings
// the Mote out sideways and comes back has not routed it straight down, and is caught
// here rather than passing on the strength of having eventually arrived.

import { newGame, spawn, unit, actTail, TILE } from "../_helpers.mjs";

// Where the filmed part of the descent begins — the counterpart to `opposite-left`'s
// FILM_FROM_X, on the other axis. The floor is 684 px tall, so picking it up at y 400
// films the last third: the Mote still visibly travelling top-to-bottom, through to
// the bottom edge.
const FILM_FROM_Y = 400;

// The far edge of the floor, where the descent is complete.
const DESCENDED_Y = 640;

/**
 * How far off its entry lane the Mote may drift and still count as going straight
 * down. Sized as in `opposite-left`, against the top vent's eight-tile width
 * (`TOP_VENT_COLS`) rather than the left vent's four-tile height — so it is wider
 * here, and still nowhere near a real sideways excursion across a 50-tile floor.
 */
const LANE_DRIFT_PX = 8 * TILE;

export default function item() {
  let moteId;
  let start;
  let r;
  let maxDrift = 0;

  /** One sample: record the sideways drift, and report progress down the floor. */
  const watch = (goal) => (snap) => {
    const u = snap.surge.find((x) => x.id === moteId);
    if (!u) return false;
    if (start) maxDrift = Math.max(maxDrift, Math.abs(u.x - start.x));
    return u.y > goal;
  };

  return {
    id: "pathing.opposite-top",

    // As with `opposite-left`: the exhaust assignment is read at the spawn, and the
    // descent as far as FILM_FROM_Y is run through the real pathing unfilmed so the
    // clip opens on the part that carries the claim. The drift is sampled across both
    // halves, because the skip is where a wandering build wanders.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      moteId = await spawn(api, "mote", "top");
      start = await unit(api, moteId);
      await api.skipUntil(watch(FILM_FROM_Y), { max: 1800, poll: 12 });
    },

    // 600 ticks = 10s, well clear of the ~4s the remaining descent takes.
    async act(api) {
      r = await api.until(watch(DESCENDED_Y), { max: 600, poll: 6 });
      await actTail(api, 90); // a beat on the Mote at the bottom exhaust
    },

    async assert(api, check) {
      check.expectEq(
        "a top-vent unit is assigned the bottom exhaust",
        start.exhaust,
        "bottom",
      );
      check.expectEq("it enters from the top vent", start.vent, "top");
      check.expectOk("it crosses down to the bottom of the floor", r.hit);
      check.expectLt(
        "on an empty floor it runs straight down, never off its lane",
        maxDrift,
        LANE_DRIFT_PX,
      );
    },
  };
}
