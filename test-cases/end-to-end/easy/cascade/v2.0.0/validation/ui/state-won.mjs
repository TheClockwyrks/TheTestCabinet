// Automated validation for the Presentation sub-item `state-won`: the won / victory
// screen is reachable, and the debug API captures it. A real win fires the cascade;
// the sim is advanced a little so the table shows the accumulating painted trail, then
// the won screen is read back and captured. Whether it reads well is judged by eye.
//
// The win is posed instantly in `arrange` (every op in `winBoard` is a control op, and
// the cascade it starts has advanced by nothing yet), so `act` decides how much of the
// cascade runs and is filmed. Three seconds of cascade is 3 x 120 = 360 ticks exactly.
// The pause before the capture is `api.settle`, not a further advance: a screenshot
// must read a PAINTED frame, which stepping does not produce, and `settle` is real
// milliseconds in both passes so the 120 ms carries over unconverted.

import { SECOND, winBoard } from "../_helpers.mjs";

export default function item() {
  // The screen the capture was taken of.
  let s;

  return {
    id: "ui.state-won",

    async arrange(api) {
      await winBoard(api, 6);
    },

    async act(api) {
      await api.advance(3 * SECOND); // paint some of the cascade trail
      s = await api.snapshot();
      await api.settle(120);
      await api.screenshot("won");
    },

    async assert(api, check) {
      check.expectEq("the won / victory screen is reachable", s.screen, "won");
    },
  };
}
