// Controls: W / Up arrow move the worker up (y decreases) and face it up.
// Injected keys drive the real movement code; the step reads the result back.

import {
  arrangeDirection,
  actDirection,
  assertDirection,
} from "../_helpers.mjs";

export default function item() {
  // What `act` measured for each key, read back by `assert`. The factory closure is
  // fresh per pass, so nothing leaks from the validate pass into the record pass.
  let results;

  return {
    id: "controls.up",

    // Enter level 1 live. Posing only — holding the keys is what consumes time.
    async arrange(api) {
      await arrangeDirection(api);
    },

    // Hold each key in turn and measure how the worker moved. This IS the clip: the
    // reviewer watches the very motion the assertions are drawn from, which is why the
    // old separate `directionClip` tail (it re-held one key purely for the camera) is
    // gone.
    async act(api) {
      results = await actDirection(api, { keys: ["KeyW", "ArrowUp"] });
    },

    async assert(api, check) {
      assertDirection(check, results, { axis: "y", sign: -1, facing: "up" });
    },
  };
}
