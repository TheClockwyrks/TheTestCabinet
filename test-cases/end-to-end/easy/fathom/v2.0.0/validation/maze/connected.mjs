// maze.connected: every open corridor tile is reachable from the forager's start.
//
// This is a structural read of the generated maze, so everything it judges is already in
// the snapshot `arrange` takes. `act` only holds still long enough for the board to be
// painted and captured — the reviewer's evidence here is the still, not motion.
import { startPlaying, floodReachable, openTiles } from "../_helpers.mjs";

export default function item() {
  let total;
  let reached;

  return {
    id: "maze.connected",

    async arrange(api) {
      const snap = await startPlaying(api);
      total = openTiles(snap).length;
      reached = floodReachable(snap, snap.forager.tx, snap.forager.ty).size;
    },

    async act(api) {
      await api.settle(120); // a REAL pause (the old wait(120)) so the board is painted
      await api.screenshot("board");
    },

    async assert(api, check) {
      check.expectEq(
        "every open corridor tile is reachable from the forager's start (one connected region)",
        reached,
        total,
      );
    },
  };
}
