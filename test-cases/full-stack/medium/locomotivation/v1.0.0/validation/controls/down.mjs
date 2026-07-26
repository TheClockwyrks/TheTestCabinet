// Controls: S / Down arrow move the worker down (y increases) and face it down.

import {
  arrangeDirection,
  actDirection,
  assertDirection,
} from "../_helpers.mjs";

export default function item() {
  // What `act` measured for each key, read back by `assert`.
  let results;

  return {
    id: "controls.down",

    // Enter level 1 live. Posing only — holding the keys is what consumes time.
    async arrange(api) {
      await arrangeDirection(api);
    },

    // Hold each key in turn and measure how the worker moved. This IS the clip, so the
    // old separate `directionClip` tail is gone: the reviewer now watches exactly the
    // motion the assertions are drawn from.
    async act(api) {
      results = await actDirection(api, { keys: ["KeyS", "ArrowDown"] });
    },

    async assert(api, check) {
      assertDirection(check, results, { axis: "y", sign: 1, facing: "down" });
    },
  };
}
