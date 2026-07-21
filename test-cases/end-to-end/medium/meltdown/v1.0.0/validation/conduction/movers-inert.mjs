// Automated validation for the Conduction sub-item `movers-inert`.
//
// The Forge and Sink have no heat of their own — a hot emitter touching one does not
// heat the mover up (specs/heat.md). We place a hot Arc between a Forge and a Sink,
// run the real heat model, and confirm both movers stay at heat 0.

import { newGame, build, tower } from "../_helpers.mjs";

export default function item() {
  let forgeId;
  let sinkId;
  let forgeHeat;
  let sinkHeat;

  return {
    id: "conduction.movers-inert",

    // A hot Arc sandwiched between the two movers, touching both.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      const arc = await build(api, "arc", 12, 12);
      forgeId = await build(api, "forge", 12, 10); // N face
      sinkId = await build(api, "sink", 12, 14); // S face
      await api.call("setHeat", arc, 95);
    },

    // 60 ticks = the old 1s of the real heat model running with a hot neighbor on a
    // shared edge — long enough that conduction would show if the movers took any.
    async act(api) {
      await api.advance(60);
      forgeHeat = (await tower(api, forgeId)).heat;
      sinkHeat = (await tower(api, sinkId)).heat;

      await api.settle(80);
      await api.screenshot("movers");
    },

    async assert(api, check) {
      check.expectClose(
        "the Forge gains no heat from a hot neighbor",
        forgeHeat,
        0,
        0.01,
      );
      check.expectClose(
        "the Sink gains no heat from a hot neighbor",
        sinkHeat,
        0,
        0.01,
      );
    },
  };
}
