// Automated validation for pathing.dismantle-repath: dismantling a structure frees its
// footprint and re-paths the floor, shortening the ground route back.
//
// A wall is placed across a leg (the route lengthens), then dismantled; the maze length must
// return to its original value.
//
// Opening the run and dropping the wall are the arrange; the DISMANTLE and the re-path it
// forces are the behavior under test and are the act. A Spark is then released so the clip
// shows the freed route actually being walked.

import { startBuild, placeCandidate, spawnControlled, snap, SECOND } from "../_helpers.mjs";

const CLIP_TICKS = 2 * SECOND;

export default function item() {
  // The wall, and the route length at each of the three stages.
  let candId;
  let len0;
  let len1;
  let len2;

  return {
    id: "pathing.dismantle-repath",

    async arrange(api) {
      const s0 = await startBuild(api);
      len0 = s0.mazeLength;

      const cand = await placeCandidate(api, "capacitor", 1, 20, 4);
      candId = cand.id;
      len1 = (await snap(api)).mazeLength;
    },

    async act(api) {
      await api.call("dismantle", candId);
      len2 = (await snap(api)).mazeLength;

      await spawnControlled(api, "spark");
      await api.advance(CLIP_TICKS);
    },

    async assert(api, check) {
      check.expectGt("the wall lengthened the route", len1, len0);
      check.expectLt("dismantling the wall shortened the route back", len2, len1);
      check.expectClose("the route returned to its original length", len2, len0, 0.001);
    },
  };
}
