// Automated validation for the Flyers sub-item `straight-line`.
//
// A Drift flyer flies a straight line from its vent to the opposite exhaust, over
// every tower and wall (specs/surge.md, reactor.md). We wall the ground lane, spawn a
// real Drift, and confirm it keeps its cross-axis (y) coordinate as it crosses to the
// right — ignoring the maze entirely.

import { newGame, build, spawn, unit } from "../_helpers.mjs";

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
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      for (const row of [14, 16, 18, 20]) await build(api, "sink", 25, row);

      driftId = await spawn(api, "drift", "left");
      start = await unit(api, driftId);
    },

    // Fly it across the floor. 1200 ticks = the old 20s cap, polled every 6 ticks
    // (the old 0.1s chunk) — the crossing is gradual, so a coarse sweep is enough.
    async act(api) {
      r = await api.until(
        (s) => s.surge.some((u) => u.id === driftId && u.x > 900),
        { max: 1200, poll: 6 },
      );
      end = await unit(api, driftId);
    },

    async assert(api, check) {
      check.expectEq("the unit is a flyer", start.flying, true);
      check.expectOk("the flyer crosses to the right, over the wall", r.hit);
      check.expectClose(
        "the flyer holds a straight line (constant y)",
        end.y,
        start.y,
        3,
      );
    },
  };
}
