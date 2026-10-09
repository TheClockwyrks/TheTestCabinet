// Automated validation for the Gameplay sub-item `serve-speed`: a served ball leaves
// at the base serve speed of 520 px/s (balls-standard.md).
//
// A fresh match is started and served; the ball's speed is read the instant it
// launches, before any bounce could change it. The serve is a precondition; the speed
// is read off the real ball state.

import { arrangeFirstServe, actServeSpeed, SERVE_SPEED } from "../_helpers.mjs";

export default function item() {
  let speed;

  return {
    id: "gameplay.serve-speed",

    // A fresh match, served and waiting to fly.
    async arrange(api) {
      await arrangeFirstServe(api);
    },

    // Read the launch speed, then let the ball travel so the clip shows it moving.
    async act(api) {
      speed = await actServeSpeed(api);
    },

    async assert(api, check) {
      check.expectClose(
        "the served ball leaves at the 520 px/s serve speed (px/s)",
        speed,
        SERVE_SPEED,
        SERVE_SPEED * 0.15,
      );
    },
  };
}
