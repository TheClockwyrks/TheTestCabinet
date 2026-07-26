// Automated validation for the Controls sub-item `pause-key`.
//
// Both Escape and P pause a live round. A round is started from the title with injected
// keys; Escape is pressed (pauses), pressed again (resumes), then P is pressed (pauses).
// Each key flows through the real key handling and the resulting screen is read back.
//
// Menu navigation is a single instant press, so starting the round is `arrange`. The
// three presses are instant too, but each screen is read IMMEDIATELY after its press —
// so a short run of play is advanced after each read, purely so the recorded clip shows
// the transitions (play -> paused -> play -> paused) instead of three invisible events.
// Those ticks come after every reading the assertions use, and pausing freezes the sim,
// so they cannot move a verdict.

import { startWithKeys } from "../_helpers.mjs";

// A beat between transitions: 4 ticks = 0.5 s. The round starts mid-board facing right
// with the pellet parked off-lane, so the few live ticks stay well clear of a wall.
const BEAT_TICKS = 4;

export default function item() {
  // The screen read straight after each press, checked by `assert`.
  let afterEscape;
  let afterResume;
  let afterP;

  return {
    id: "controls.pause-key",

    async arrange(api) {
      await startWithKeys(api);
    },

    async act(api) {
      await api.advance(BEAT_TICKS); // a moment of visible play before the first press

      await api.call("press", "Escape");
      afterEscape = (await api.snapshot()).screen;
      await api.advance(BEAT_TICKS); // hold on the pause overlay (the sim is frozen)

      await api.call("press", "Escape"); // resume
      afterResume = (await api.snapshot()).screen;
      await api.advance(BEAT_TICKS); // play resumes on camera

      await api.call("press", "KeyP");
      afterP = (await api.snapshot()).screen;
      await api.advance(BEAT_TICKS); // hold on the pause overlay again
    },

    async assert(api, check) {
      check.expectEq("Escape pauses a live round", afterEscape, "paused");
      check.expectEq("Escape resumes from pause", afterResume, "playing");
      check.expectEq("P pauses a live round", afterP, "paused");
    },
  };
}
