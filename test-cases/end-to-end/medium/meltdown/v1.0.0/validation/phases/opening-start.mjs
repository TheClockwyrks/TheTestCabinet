// Automated validation for the Phases sub-item `opening-start`.
//
// Pressing Start in the opening phase begins Wave 1 (specs/economy.md, states.md).
// We send from the opening phase and confirm the match enters the wave phase at
// wave 1.

import { newGame, actTail } from "../_helpers.mjs";

export default function item() {
  let s;

  return {
    id: "phases.opening-start",

    // The untimed opening phase, with lives posed high so the wave it releases cannot
    // end the run under the check.
    async arrange(api) {
      await newGame(api, "containment", "medium");
      await api.call("setLives", 100000);
    },

    // `startWave` and the snapshot that reads the verdict both consume no time, so on
    // its own this `act` is over before the record pass has filmed a single frame of
    // it — the clip caught the opening phase and stopped, never showing the wave it
    // is about. The drive therefore runs on into wave 1 proper, long enough for the
    // HUD to flip to the wave phase and for the first of the wave's units to come
    // through the vent under their own power.
    //
    // The verdict is still read at the instant Start is pressed, not after the tail:
    // "Start begins wave 1" is a claim about that moment, and a snapshot taken a few
    // seconds later could not tell a build that entered wave 1 on the press from one
    // that drifted into it on its own.
    // A beat runs BEFORE the press too. `act` is where the record pass starts filming,
    // so with `startWave` as its first statement the clip opened on the frame the wave
    // began — the opening phase this item is about never appeared, and what a reviewer
    // got was a wave already running with nothing to say it had just been started. The
    // lead-in shows the state being left: the untimed opening phase, WAVE 0, the wave
    // control reading Start. Then it is pressed, on screen, and the wave arrives.
    //
    // It costs the verdict nothing. The opening phase "never starts on its own"
    // (specs/gameplay.md) — which is `phases.opening-untimed`'s claim, checked there
    // over thirty times this long — so the two seconds change nothing about the state
    // `startWave` is pressed from, and `s` is still read on the press itself.
    async act(api) {
      await actTail(api, 120); // 2 s of the untimed opening phase before the press
      await api.call("startWave");
      s = await api.snapshot();
      await actTail(api, 240); // 4 s — the wave visibly under way
    },

    async assert(api, check) {
      check.expectEq("Start begins the wave phase", s.phase, "wave");
      check.expectEq("it begins Wave 1", s.wave, 1);
    },
  };
}
