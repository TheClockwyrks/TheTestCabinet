// maze.den-reachable: a predator released from the den can reach the forager — there is
// a predator-traversable path from the den, out through its gate, to the forager's spawn
// tile. A den walled off from the corridors (a gate that opens onto rock, or a den sealed
// off from its own gate) strands the predators so they can never hunt the player, and
// fails this. This is the counterpart to den-enclosed/den-one-exit: those confirm the den
// is closed except for one gate; this confirms that one gate actually connects.
//
// A structural read of the generated maze: everything judged is already in the snapshot
// `arrange` takes. The predator graph is corridors + den + gate (specs/trench.md; the
// reference `Maze.predOpen`), distinct from the corridor-only graph maze.connected floods
// — so connectivity of the open corridors does not, on its own, imply the den connects.
// `act` only holds still long enough for the board to be painted and captured.
import {
  startPlaying,
  denTiles,
  gateTiles,
  predatorReachable,
  unmetPrecondition,
} from "../_helpers.mjs";

export default function item() {
  let reached;

  return {
    id: "maze.den-reachable",

    async arrange(api) {
      const snap = await startPlaying(api);
      // Predators START inside the den and exit through the gate, so the path is traced
      // from the den. The den ('d') and/or gate ('g') must be marked for that path to be
      // traceable; a maze that marks neither leaves the scenario unposeable rather than
      // failed (as in den-enclosed / den-one-exit). When only the gate is marked, seed the
      // flood from it instead.
      const den = denTiles(snap);
      const gates = gateTiles(snap);
      if (!den.length && !gates.length) {
        throw unmetPrecondition("no den or gate tiles marked in the maze");
      }
      const set = predatorReachable(snap, den.length ? den : gates);
      reached = set.has(`${snap.forager.tx},${snap.forager.ty}`);
    },

    async act(api) {
      await api.settle(120); // a REAL pause so the board is painted
      await api.screenshot("board");
    },

    async assert(api, check) {
      check.expectOk(
        "a predator leaving the den can reach the forager's spawn (the den is not walled off)",
        reached,
      );
    },
  };
}
