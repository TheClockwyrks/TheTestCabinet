// Controls: A / Left arrow move the worker left (x decreases) and face it left.

import {
  arrangeDirection,
  actDirection,
  assertDirection,
} from "../_helpers.mjs";

export default function item() {
  // What `act` measured for each key, read back by `assert`.
  let results;

  return {
    id: "controls.left",

    // Enter level 1 live. Posing only — holding the keys is what consumes time.
    async arrange(api) {
      await arrangeDirection(api);
    },

    // Hold each key in turn and measure how the worker moved. This IS the clip, so the
    // old separate `directionClip` tail is gone: the reviewer now watches exactly the
    // motion the assertions are drawn from.
    async act(api) {
      results = await actDirection(api, { keys: ["KeyA", "ArrowLeft"] });
    },

    async assert(api, check) {
      assertDirection(check, results, { axis: "x", sign: -1, facing: "left" });
    },
  };
}
