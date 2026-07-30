// Automated validation for pathing.dismantle-repath: dismantling a structure frees its
// footprint and re-paths the floor, shortening the ground route back.
//
// A wall is placed across a leg (the route lengthens), then dismantled; the maze length must fall,
// and must land back on its original value.
//
// WHY THE LENGTHENING IS A PRECONDITION AND NOT A CHECK. This used to assert "the wall lengthened
// the route" as its first graded point, which is `pathing/shortest-open-route`'s whole subject — so
// one build defect failed two review items, and this item's OWN subject (that dismantling
// re-paths) went unmeasured either way. The lengthening is now the pose: if it did not take, there
// is no shortening to observe, and the point is left inconclusive for the reviewer rather than
// failed a second time for a defect the other item already reports.
//
// Opening the run and dropping the wall are the arrange; the DISMANTLE and the re-path it
// forces are the behavior under test and are the act. A Spark is then released so the clip
// shows the freed route actually being walked.

import {
  startBuild,
  buildMazeWall,
  spawnControlled,
  snap,
  unmetPrecondition,
  MAZE_WALL,
  SECOND,
} from "../_helpers.mjs";

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

      candId = await buildMazeWall(api);
      len1 = (await snap(api)).mazeLength;
      if (!(len1 > len0)) {
        throw unmetPrecondition(
          `the wall at (${MAZE_WALL.col},${MAZE_WALL.row}) did not lengthen the route ` +
            `(${len0} -> ${len1}), so dismantling it has no shortening to show`,
        );
      }
    },

    async act(api) {
      await api.call("dismantle", candId);
      len2 = (await snap(api)).mazeLength;

      await spawnControlled(api, "spark");
      await api.advance(CLIP_TICKS);
    },

    async assert(api, check) {
      check.expectLt("dismantling the wall shortened the route back", len2, len1);
      check.expectClose("the route returned to its original length", len2, len0, 0.001);
    },
  };
}
