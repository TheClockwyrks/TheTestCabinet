// Automated validation for foes.dropper-reseeds: the packet-dropper falls straight
// down a column, laying a fresh inert node in each empty tile it passes.
//
// A dropper posed at the top of an empty column is the precondition; the reseeding is
// produced by the real updateFoe dropper branch (game.dropNode) as the sim steps.
// After it falls through, the column holds a run of fresh inert nodes.

import { freshBoard, tileCX } from "../_helpers.mjs";

const COL = 10;

export default function item() {
  let startCount;
  let laid;

  return {
    id: "foes.dropper-reseeds",

    async arrange(api) {
      await freshBoard(api);
      await api.call("spawnFoe", "dropper", { x: tileCX(COL) });
    },

    // The whole fall IS the clip: the reviewer watches the column fill in behind the
    // dropper, which is exactly the run of nodes the assertions count.
    async act(api) {
      startCount = (await api.snapshot()).nodes.filter(
        (n) => n.c === COL,
      ).length;
      await api.advance(504); // 504 ticks = the old 4.2s, the fall through the reseed rows
      laid = (await api.snapshot()).nodes.filter((n) => n.c === COL);
    },

    async assert(api, check) {
      check.expectEq("the column starts empty", startCount, 0);
      check.expectGt(
        "the dropper lays a run of nodes down its column",
        laid.length,
        8,
      );
      check.expectOk(
        "every laid node is inert (charge 0)",
        laid.every((n) => n.charge === 0),
      );
    },
  };
}
