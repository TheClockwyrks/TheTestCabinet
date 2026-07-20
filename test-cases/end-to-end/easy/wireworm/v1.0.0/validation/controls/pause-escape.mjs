// Automated validation for controls.pause-escape: pressing Escape during play pauses
// the game. Injected input flows through the real key handling.

import {
  actPauseControl,
  arrangePauseControl,
  assertPauseControl,
} from "../_helpers.mjs";

const CONTROL = { code: "Escape" };

export default function item() {
  let screen;

  return {
    id: "controls.pause-escape",
    async arrange(api) {
      await arrangePauseControl(api);
    },
    // A beat of visible play, the press, then a hold on the result — one timed run
    // that is both the verdict and the clip. The old script decided the verdict from
    // an instant press and then re-posed a separate real-time clip; the pause verdict
    // never depended on that timing.
    async act(api) {
      screen = await actPauseControl(api, CONTROL.code);
    },
    async assert(api, check) {
      assertPauseControl(check, screen, CONTROL);
    },
  };
}
