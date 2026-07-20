// Automated validation for the Gravity item `saucer-free`: the saucer is a powered craft
// and is never pulled by the star. A saucer is posed well off the star (clear of its
// avoidance radius) crossing horizontally with no vertical velocity; after the real sim
// steps it must not have gained any velocity toward the star — a rock in the same spot
// would curve toward it.
//
// Posing the saucer is the precondition (`arrange`); the crossing is the behavior (`act`), so
// the clip shows it hold a dead-straight line where a rock would visibly bend. 0.5 s x 120 Hz
// = 60 ticks.

import { newGame } from "../_helpers.mjs";

export default function item() {
  // The saucer after crossing, read by `assert`.
  let s;

  return {
    id: "gravity.saucer-free",

    async arrange(api) {
      await newGame(api);
      await api.call("spawnSaucer");
      await api.call("setSaucer", { x: 200, y: 200, vx: 140, vy: 0 });
    },

    async act(api) {
      await api.advance(60);
      s = (await api.snapshot()).saucer;
    },

    async assert(api, check) {
      check.expectOk("the saucer is on the field", Boolean(s));
      check.expectClose(
        "the saucer gains no vertical pull toward the star",
        s.vy,
        0,
        0.5,
      );
      check.expectClose(
        "it holds its height (it is not pulled toward the star)",
        s.y,
        200,
        2,
      );
    },
  };
}
