// maze.den-enclosed: the den is fully enclosed by walls, except the gate.
//
// A structural read of the generated maze: the den interior ('d') must border open
// corridor ('.') only through the gate, never through open rock. Everything judged is
// already in the snapshot `arrange` takes, and `act` only holds still long enough to
// capture the board.
import {
  startPlaying,
  denTiles,
  denCorridorBreaches,
  unmetPrecondition,
} from "../_helpers.mjs";

export default function item() {
  let breaches;

  return {
    id: "maze.den-enclosed",

    async arrange(api) {
      const snap = await startPlaying(api);
      // The den interior must be marked ('d') for its enclosure to be checkable; a
      // maze that marks no den interior leaves the scenario unposeable rather than failed.
      if (!denTiles(snap).length) {
        throw unmetPrecondition("no den-interior tiles marked in the maze");
      }
      breaches = denCorridorBreaches(snap).length;
    },

    async act(api) {
      await api.settle(120); // a REAL pause so the board is painted
      await api.screenshot("board");
    },

    async assert(api, check) {
      check.expectEq(
        "the den interior borders no open corridor (fully enclosed by walls except the gate)",
        breaches,
        0,
      );
    },
  };
}
