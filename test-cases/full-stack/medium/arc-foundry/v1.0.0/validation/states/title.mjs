// Automated validation for states.title: the title / main menu is the initial state. The
// screen is read back and captured so a reviewer sees the actual menu.
//
// The reset is the arrange; the act holds long enough for the title to come up, reads it back,
// and captures it. There is nothing to drive here — the claim is about the INITIAL state — so
// the act is the settle and the capture.

import { snap } from "../_helpers.mjs";

// The old script waited 120 ms for the title to come up. At 60 Hz that is 7.2 ticks; the tick
// contract rejects a fraction rather than rounding it, so round UP to 8 — a settle must never
// come out shorter than it was, and title screens often animate in.
const SETTLE_TICKS = 8;

export default function item() {
  // The initial screen, read by `assert`.
  let screen;

  return {
    id: "states.title",

    async arrange(api) {
      await api.reset();
    },

    async act(api) {
      await api.advance(SETTLE_TICKS);
      screen = (await snap(api)).screen;

      await api.screenshot("title");
    },

    async assert(api, check) {
      check.expectEq("the title / main menu is the initial screen", screen, "title");
    },
  };
}
