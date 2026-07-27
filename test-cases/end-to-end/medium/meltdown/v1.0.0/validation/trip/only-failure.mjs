// Automated validation for the Trip sub-item `only-failure`.
//
// A tower is never destroyed or damaged by the surge — overheating is the only way
// it fails (specs/heat.md). We place a tower beside the lane, drive a stream of real
// units past it (they leak), and confirm the tower is still there, unchanged, after
// the surge has passed.

import { newGame, build, spawn, tower } from "../_helpers.mjs";

export default function item() {
  let id;
  let placed;
  let t;

  return {
    id: "trip.only-failure",

    // A lone tower beside the lane and a stream of real units released at it. Lives
    // are posed high because every one of these units is meant to leak past.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      id = await build(api, "arc", 10, 22);
      placed = id !== null;
      for (let i = 0; i < 6; i += 1) await spawn(api, "mote", "left");
    },

    // Let the whole stream walk the floor and leak past the tower. 1800 ticks = the
    // old 30s cap, polled every 6 ticks (the old 0.1s chunk).
    async act(api) {
      await api.until((s) => s.surge.length === 0, { max: 1800, poll: 6 });
      t = await tower(api, id);
    },

    async assert(api, check) {
      check.expectOk("the tower placed", placed);
      // Hard: the trip read below is off the tower, so a soft guard would let the
      // script throw on a null instead — which the driver records as the build
      // failing the debug-API contract rather than as this check's own verdict.
      check.assertOk(
        "the tower is still present after the surge passed",
        t !== null,
      );
      check.expectEq(
        "the tower was not tripped by the surge",
        t.tripped,
        false,
      );
    },
  };
}
