// Automated validation for the Trip sub-item `only-failure`.
//
// A tower is never destroyed or damaged by the surge — overheating is the only way
// it fails (specs/heat.md). We place a tower beside the lane, drive a stream of real
// units past it (they leak), and confirm the tower is still there, unchanged, after
// the surge has passed.

import { newGame, build, spawn, tower, actTail } from "../_helpers.mjs";

export default function item() {
  let id;
  let placed;
  let t;

  return {
    id: "trip.only-failure",

    // Long enough for the last of the stream to clear the floor at its real pace,
    // with the skipped front of it costing nothing. See CLIP_HEADROOM_MS in _helpers.
    clipMs: 9000,

    // A lone tower beside the lane and a stream of real units released at it. Lives
    // are posed high because every one of these units is meant to leak past.
    //
    // The stream then walks the whole floor, which for six Motes at 60 px/s is the
    // better part of twenty seconds — and the finding is not the walk, it is the
    // tower's condition at the end of it. So the front of the stream is run through
    // unfilmed and the clip is the back of it still going past an intact, untripped
    // Arc. 1800 ticks = the old 30s cap, kept as the skip's ceiling.
    //
    // POLLED COARSELY, AND DELIBERATELY. A skip is not invisible: the build's render
    // loop keeps painting throughout it, so every sample the sweep takes is a frame,
    // and a fine poll turns the fast-forward into footage of Motes streaking across
    // the floor at ten times life speed — which is worse to watch than the walk it was
    // meant to spare a reviewer. A coarse poll takes few enough samples that the
    // skipped stretch reads as a couple of jump cuts instead, and the sweep still stops
    // in the right place because "how many units are left" changes slowly. Stopping at
    // three (rather than one) also leaves more of the stream to film at its real pace.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      id = await build(api, "arc", 10, 22);
      placed = id !== null;
      for (let i = 0; i < 6; i += 1) await spawn(api, "mote", "left");
      await api.skipUntil((s) => s.surge.length <= 3, { max: 1800, poll: 120 });
    },

    // Let the rest of the stream leak past the tower. 900 ticks = 15s, ample for the
    // last three Motes' remaining walk.
    async act(api) {
      await api.until((s) => s.surge.length === 0, { max: 900, poll: 6 });
      t = await tower(api, id);
      await actTail(api, 90); // a beat on the tower, whole and online, floor clear
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
