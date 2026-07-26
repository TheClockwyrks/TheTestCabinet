// Automated validation for the Rime sub-item `degrades-with-heat`.
//
// The Rime's slow fraction falls as it heats, degrading to nothing at the trip — it
// runs the heat rule backward (specs/heat.md). Heat is posed across the range as a
// precondition and the real slow-fraction the game reports is read back at each
// step; it must fall monotonically to ~0 at 100.

import { newGame, build, tower } from "../_helpers.mjs";

const HEATS = [0, 25, 50, 75, 100];

export default function item() {
  let rimeId;
  const slows = [];

  return {
    id: "rime.degrades-with-heat",

    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      rimeId = await build(api, "rime", 12, 12);
    },

    // Walk the Rime up the heat range and read the real slow fraction at each stop,
    // then return it to cold for the still.
    async act(api) {
      for (const h of HEATS) {
        await api.call("setHeat", rimeId, h);
        slows.push((await tower(api, rimeId)).slowFactor);
      }

      await api.call("setHeat", rimeId, 0);
      await api.settle(80);
      await api.screenshot("degrade");
    },

    async assert(api, check) {
      check.expectClose(
        "a cold Rime slows at its full ceiling",
        slows[0],
        0.55,
        0.02,
      );
      check.expectClose("a fully-hot Rime no longer slows", slows[4], 0, 0.01);
      for (let i = 1; i < slows.length; i += 1) {
        check.expectLt(
          `the slow at heat ${HEATS[i]} is weaker than at ${HEATS[i - 1]}`,
          slows[i],
          slows[i - 1],
        );
      }
    },
  };
}
