// Automated validation for the Flyers sub-item `straight-line`.
//
// A Drift flyer flies a straight line from its vent to the opposite exhaust, over
// every tower and wall (specs/surge.md, reactor.md). We wall the ground lane, spawn a
// real Drift, and confirm it keeps its cross-axis (y) coordinate as it crosses to the
// right — ignoring the maze entirely.

import { newGame, build, spawn, unit, FLOOR_X0, TILE } from "../_helpers.mjs";

// Where the filmed part of the flight begins: a couple of tiles short of the Sink
// wall at column 25, so the clip opens with the wall ahead of the Drift and carries it
// over and past.
const WALL_APPROACH_X = FLOOR_X0 + 23 * TILE;

export default function item() {
  let driftId;
  let start;
  let end;
  let r;

  return {
    id: "flyers.straight-line",

    // A wall across the ground lane — a flyer ignores it. Built from Sinks (movers
    // that never fire) so the wall proves the flyer flies over the maze without any
    // emitter shooting it out of the air along the way.
    //
    // What makes the line straight is that it stays straight ACROSS the wall, so the
    // filmed part has to contain the wall. The approach to it does not: the Drift's
    // run-up from the vent is a flyer over bare floor, which is the same picture on a
    // build that would have turned. So the run-up is skipped and the clip opens just
    // short of the Sinks. 1200 ticks = the old 20s cap, kept as the skip's ceiling.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      for (const row of [14, 16, 18, 20]) await build(api, "sink", 25, row);

      driftId = await spawn(api, "drift", "left");
      start = await unit(api, driftId);
      await api.skipUntil(
        (s) => s.surge.some((u) => u.id === driftId && u.x > WALL_APPROACH_X),
        { max: 1200, poll: 12 },
      );
    },

    // Fly it the rest of the way across. 600 ticks = 10s, ample for the remaining
    // ~550 px at 80 px/s.
    async act(api) {
      r = await api.until(
        (s) => s.surge.some((u) => u.id === driftId && u.x > 900),
        { max: 600, poll: 6 },
      );
      end = await unit(api, driftId);
    },

    async assert(api, check) {
      check.expectEq("the unit is a flyer", start.flying, true);
      // Hard: the cross-axis read below is off `end`, so a soft guard would let the
      // script throw on a null instead — which the driver records as the build
      // failing the debug-API contract rather than as this check's own verdict.
      check.assertOk(
        "the flyer crosses to the right, over the wall",
        r.hit && end !== null,
      );
      check.expectClose(
        "the flyer holds a straight line (constant y)",
        end.y,
        start.y,
        3,
      );
    },
  };
}
