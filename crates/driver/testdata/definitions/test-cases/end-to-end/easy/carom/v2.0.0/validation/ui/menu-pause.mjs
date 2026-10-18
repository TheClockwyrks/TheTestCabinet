// Automated validation for the UI sub-item `state-pause`: the pause menu is
// reachable, and the debug API captures it so a reviewer sees the actual menu.
//
// A match is started with injected keys and played into a live rally, then paused
// with Esc; the screen is read back and a screenshot captured as the reviewer's
// proof. Whether the menu (resume / restart / quit) reads well is left to the reviewer
// from the capture. See validation/_helpers.mjs.
//
// The menu navigation is instant, so starting the match is `arrange`. Everything the
// pause has to be posed against — getting past the pre-serve hold into a real rally,
// so the capture shows the menu over live play rather than over a countdown — consumes
// time, so it is `act`.

import { startWithKeys } from "../_helpers.mjs";

// Past the pre-serve hold and into a live rally: 1.3s x 120 Hz = 156 ticks exactly.
const RALLY_TICKS = 156;

// The old script waited 120ms twice — once to let the rally draw before pausing, once
// to let the pause menu draw before reading and capturing it. At 120 Hz each is 14.4
// ticks, which the tick contract rejects rather than rounds, so round UP to the next
// whole tick: both are paint settles, which only have to be at least as long as they
// were, and one extra tick (~8ms) changes neither the rally nor the menu.
const SETTLE_TICKS = 15;

export default function item() {
  // The screen `act` read after the pause key, checked by `assert`.
  let screen;

  return {
    id: "ui.state-pause",

    async arrange(api) {
      await startWithKeys(api, "versus");
    },

    async act(api) {
      await api.advance(RALLY_TICKS); // past the pre-serve hold, into a live rally
      await api.advance(SETTLE_TICKS); // let the live field draw before pausing
      await api.call("press", "Escape"); // pause
      await api.advance(SETTLE_TICKS); // let the pause menu draw
      screen = (await api.snapshot()).screen;
      await api.screenshot("pause");
    },

    async assert(api, check) {
      check.expectEq(
        "pressing Esc during a match opens the pause menu",
        screen,
        "paused",
      );
    },
  };
}
