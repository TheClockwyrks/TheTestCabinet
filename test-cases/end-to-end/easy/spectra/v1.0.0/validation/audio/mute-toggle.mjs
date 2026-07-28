// Automated validation for the Audio sub-item `mute-toggle`.
//
// The mute key (M) toggles mute. It is pressed during a live wave — where a player
// reaches for it, and where the cues it governs are actually playing — and the
// `muted` flag read back after each press: off, on, off again.
//
// It is a TOGGLE that is checked, not just that one press sets the flag. A build
// that latches mute on and cannot un-mute would have passed the old single press,
// and `specs/ui.md` is explicit that the game "stays fully playable with sound
// muted" and provides a mute toggle — which only means anything if it goes both
// ways. The capture also moves off the title: nothing about a title screen changes
// when mute flips, so the still said nothing at all; over a live wave the reviewer
// at least sees the game the mute applies to, and can judge whatever tell the build
// shows for it.
//
// What is deliberately NOT asserted is silence. The driver's audio probe records
// every Web Audio source a build STARTS (see `api.audio`), and muting by riding a
// gain node to zero — an entirely ordinary implementation — still starts its
// sources. Reading "no cue fired while muted" would fail those builds for muting
// correctly, so the snapshot's own `muted` flag is the honest signal.

import { startClean, LEAD_IN_TICKS } from "../_helpers.mjs";

const muted = async (api) => (await api.snapshot()).muted;

// A beat between presses, so the clip is not two toggles in the same frame.
const BEAT_TICKS = 90;

export default function item() {
  // The muted flag before any press, after the first, and after the second.
  let before;
  let afterOn;
  let afterOff;

  return {
    id: "audio.mute-toggle",

    // A live stage-1 wave with its swarm kept, so the capture shows the running game
    // the mute applies to rather than a static title. Mute starts off.
    async arrange(api) {
      await startClean(api, { clear: false });
      before = await muted(api);
    },

    // Each press is instant, so the advances here are purely so the clip has three
    // distinct beats. The settle before the capture is a real pause in both passes:
    // the screenshot must read a frame painted after the toggle, which no amount of
    // instant stepping produces.
    async act(api) {
      await api.advance(LEAD_IN_TICKS);

      await api.call("press", "KeyM");
      afterOn = await muted(api);
      await api.advance(BEAT_TICKS);

      await api.settle(120);
      await api.screenshot("mute");

      await api.call("press", "KeyM");
      afterOff = await muted(api);
      await api.advance(BEAT_TICKS);
    },

    async assert(api, check) {
      check.expectOk("mute starts off", before === false);
      check.expectOk("pressing M toggles mute on", afterOn === true);
      check.expectOk(
        "pressing M again toggles mute back off",
        afterOff === false,
      );
    },
  };
}
