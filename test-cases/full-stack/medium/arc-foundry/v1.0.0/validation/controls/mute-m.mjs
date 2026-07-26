// Automated validation for controls.mute-m: pressing M toggles audio mute.
//
// The reset is the arrange; the M KEY PRESS and the reads either side of it are the act.

import { snap } from "../_helpers.mjs";

// The old script waited 80 ms after the reset for the build to come up. At 60 Hz that is 4.8
// ticks, which the tick contract rejects rather than rounds, so round UP to 5: a settle only
// has to be at LEAST as long as it was, never shorter.
const SETTLE_TICKS = 5;

export default function item() {
  // The mute flag either side of the press, read by `assert`.
  let before;
  let after;

  return {
    id: "controls.mute-m",

    async arrange(api) {
      await api.reset();
    },

    async act(api) {
      await api.advance(SETTLE_TICKS);
      before = (await snap(api)).muted;
      await api.call("press", "KeyM");
      after = (await snap(api)).muted;

      await api.screenshot("mute");
    },

    async assert(api, check) {
      check.expectEq("mute starts off", before, false);
      check.expectEq("pressing M toggles mute on", after, true);
    },
  };
}
