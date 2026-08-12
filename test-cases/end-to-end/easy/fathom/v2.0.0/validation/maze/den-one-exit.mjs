// maze.den-one-exit: there is exactly one exit from the den — a single den gate.
//
// A structural read of the generated maze: the den ('d') region opens to the corridors
// through exactly one gate tile ('g'). Everything judged is already in the snapshot
// `arrange` takes, and `act` only holds still long enough to capture the board.
//
// The still is framed on the den. The verdict does not depend on it — the count comes
// off `snapshot.tiles` — but a picture of a forager standing wherever it happens to
// spawn shows a reviewer nothing about the den's exits: the maze is dark, and only what
// the forager's light reaches is drawn at all. So the forager is walked to the corridor
// tile outside the gate and lit up, which puts the chamber and its one entrance in the
// frame. See `arrangeDenView`.
import {
  startPlaying,
  denTiles,
  gateTiles,
  arrangeDenView,
  unmetPrecondition,
} from "../_helpers.mjs";

export default function item() {
  let gates;

  return {
    id: "maze.den-one-exit",

    async arrange(api) {
      const snap = await startPlaying(api);
      // The den and its gate must be marked ('d' / 'g') for the exit count to be
      // checkable; a maze that marks neither leaves the scenario unposeable rather
      // than failed.
      if (!denTiles(snap).length && !gateTiles(snap).length) {
        throw unmetPrecondition("no den or gate tiles marked in the maze");
      }
      gates = gateTiles(snap).length;
      await arrangeDenView(api, snap);
    },

    async act(api) {
      await api.settle(120); // a REAL pause so the board is painted
      await api.screenshot("board");
    },

    async assert(api, check) {
      check.expectEq("the den has exactly one gate (a single exit)", gates, 1);
    },
  };
}
