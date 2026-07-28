// Automated validation for the Pathing sub-item `opposite-left`.
//
// A unit entering the left vent is assigned the right (opposite) exhaust and leaves
// there, never the nearer one (specs/playfield.md). We spawn a real Mote at the left
// vent, read its assigned exhaust, and drive it across the floor to the right edge.
//
// Reaching the right edge is necessary but not sufficient, and on its own it passed a
// build that had no business passing: one implementation walked the Mote UP to the top
// of the reactor, along the top edge, and back down diagonally to the exhaust. It
// arrived, so "it crosses to the right side of the floor" held, and the item reported
// a conformant route. On an EMPTY floor there is nothing to route around — the maze is
// what bends a path (specs/playfield.md), and with no towers placed the route from the
// left vent to the right exhaust is a straight run down the lane. So the drive also
// watches the cross-axis: the Mote's `y` must stay in the band it started in the whole
// way across. A detour to the top of the reactor leaves that band by hundreds of
// pixels and now fails here rather than being somebody else's problem.

import { newGame, spawn, unit, actTail, TILE } from "../_helpers.mjs";

// Where the filmed part of the crossing begins. The Mote enters at the left edge and
// is bound for the right one, and a clip has to show enough travel to read as a
// crossing rather than a unit that was always over there — but not the whole 16 s
// walk, of which the middle stretch distinguishes nothing. Picking it up at x 600
// films the final third: the Mote still visibly moving left-to-right, past the point
// where a near-exhaust route would have diverged, through to the right edge.
const FILM_FROM_X = 600;

// The far edge of the floor, where the crossing is complete.
const CROSSED_X = 900;

/**
 * How far off its entry lane the Mote may drift and still count as going straight
 * across.
 *
 * Four tiles. Wide enough that nothing legitimate trips it — the left vent is four
 * tiles tall (`LEFT_VENT_ROWS`), so a build is free to enter anywhere in it, centre
 * the unit in its lane, or ease it onto a tile centre, and any of those moves the
 * cross-axis by a tile or two. Narrow enough that it cannot be confused with routing:
 * the reactor is 36 tiles tall, so a run up to the top edge and back is off by fifteen
 * tiles or more.
 */
const LANE_DRIFT_PX = 4 * TILE;

export default function item() {
  let moteId;
  let start;
  let r;
  let maxDrift = 0;

  /**
   * One sample: record how far the Mote has strayed from the lane it entered on, and
   * report whether it has reached `goal` on the travel axis.
   *
   * Shared by both sweeps, because the drift has to be measured over the WHOLE
   * crossing. The skip is where a wandering build does its wandering; a sweep that
   * only watched the filmed stretch would miss the detour entirely and see a Mote
   * arriving tidily at the exhaust.
   */
  const watch = (goal) => (snap) => {
    const u = snap.surge.find((x) => x.id === moteId);
    if (!u) return false;
    if (start) maxDrift = Math.max(maxDrift, Math.abs(u.y - start.y));
    return u.x > goal;
  };

  return {
    id: "pathing.opposite-left",

    // The exhaust assignment is read at the spawn, before anything moves; the walk out
    // to FILM_FROM_X is then run through the real pathing unfilmed, so the clip opens
    // on the part of the crossing that carries the claim. 1800 ticks = the old 30s cap
    // — the skip decides nothing, so it keeps the generous ceiling.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      moteId = await spawn(api, "mote", "left");
      start = await unit(api, moteId);
      await api.skipUntil(watch(FILM_FROM_X), { max: 1800, poll: 12 });
    },

    // Drive the rest of the way to the right side of the floor (the opposite exhaust).
    // 600 ticks = 10s, well clear of the ~6s the remaining stretch takes.
    async act(api) {
      r = await api.until(watch(CROSSED_X), { max: 600, poll: 6 });
      await actTail(api, 90); // a beat on the Mote at the right exhaust
    },

    async assert(api, check) {
      check.expectEq(
        "a left-vent unit is assigned the right exhaust",
        start.exhaust,
        "right",
      );
      check.expectEq("it enters from the left vent", start.vent, "left");
      check.expectOk("it crosses to the right side of the floor", r.hit);
      check.expectLt(
        "on an empty floor it runs straight across, never off its lane",
        maxDrift,
        LANE_DRIFT_PX,
      );
    },
  };
}
