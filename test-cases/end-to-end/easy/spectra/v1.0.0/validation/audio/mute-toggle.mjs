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
//
// WHAT IS ALSO ASSERTED IS THE ON-SCREEN TELL. `specs/ui.md` requires a persistent
// mute indicator in the bottom HUD strip whenever sound is muted — appearing when
// mute goes on, disappearing when it goes off, and the only thing about the screen
// that muting changes. That is a rendered fact, so it is read the way this case
// reads every rendered fact: by sampling the pixels the build actually paints
// (`sampleBox` over the strip) and confirming the region CHANGES when mute goes on
// and returns when it goes off.
//
// This is what makes the capture worth having. Without it the screenshot filed
// under "mute toggled on" was indistinguishable from the unmuted game — nothing on
// screen differed — so the still told the reviewer nothing at all.

import {
  startStageClean,
  arrangeAssembledWave,
  sampleBox,
  colorDistance,
  LEAD_IN_TICKS,
} from "../_helpers.mjs";

const muted = async (api) => (await api.snapshot()).muted;

// A beat between presses, so the clip is not two toggles in the same frame.
const BEAT_TICKS = 90;

// The bottom HUD strip (`specs/playfield.md`: y 656..720), sampled across its full
// width so the tell is found wherever in the strip a build places it.
const STRIP = { x0: 20, y0: 660, x1: 1260, y1: 716 };
const GRID_X = 40;
const GRID_Y = 6;

// How much the strip's mean color must move for a tell to count as drawn.
//
// Deliberately small: the indicator is one small glyph or short label in a wide
// strip, so its contribution to the region's mean is a couple of units even when it
// is perfectly legible. What this separates is "something was added" from "nothing
// changed at all", which is the difference between a build that draws the tell and
// one that does not.
const TELL_MIN = 0.6;

export default function item() {
  // The muted flag before any press, after the first, and after the second.
  let before;
  let afterOn;
  let afterOff;
  // …and the bottom strip as painted at each of those three points.
  let stripBefore;
  let stripOn;
  let stripOff;

  return {
    id: "audio.mute-toggle",

    // The real stage-1 wave, flown in and then HELD, so the capture shows the game
    // the mute applies to rather than a static title. Mute starts off.
    //
    // Held rather than left running because the strip is now SAMPLED, and the bottom
    // strip is not guaranteed to be untouched by play: `specs/playfield.md` lets a
    // diving drone cross it in transit as it wraps. A diver passing through the
    // strip on the tick a sample is taken would move the reading as surely as the
    // mute tell does. Held, the only thing that can change the strip between the
    // three readings is the toggle under test.
    async arrange(api) {
      await startStageClean(api, 1, { clear: false });
      await arrangeAssembledWave(api);
      before = await muted(api);
    },

    // Each press is instant, so the advances here are purely so the clip has three
    // distinct beats. The settle before the capture is a real pause in both passes:
    // the screenshot must read a frame painted after the toggle, which no amount of
    // instant stepping produces.
    async act(api) {
      await api.advance(LEAD_IN_TICKS);

      // The strip as it reads UNMUTED, which the two readings below are compared
      // against. `settle` is a real pause in both passes and the only thing that
      // guarantees a painted frame to sample.
      await api.settle(120);
      stripBefore = await sampleBox(
        api,
        STRIP.x0,
        STRIP.y0,
        STRIP.x1,
        STRIP.y1,
        GRID_X,
        GRID_Y,
      );

      await api.call("press", "KeyM");
      afterOn = await muted(api);
      await api.advance(BEAT_TICKS);

      await api.settle(120);
      stripOn = await sampleBox(
        api,
        STRIP.x0,
        STRIP.y0,
        STRIP.x1,
        STRIP.y1,
        GRID_X,
        GRID_Y,
      );
      await api.screenshot("mute");

      await api.call("press", "KeyM");
      afterOff = await muted(api);
      await api.advance(BEAT_TICKS);

      await api.settle(120);
      stripOff = await sampleBox(
        api,
        STRIP.x0,
        STRIP.y0,
        STRIP.x1,
        STRIP.y1,
        GRID_X,
        GRID_Y,
      );
    },

    async assert(api, check) {
      check.expectOk("mute starts off", before === false);
      check.expectOk("pressing M toggles mute on", afterOn === true);
      check.expectOk(
        "pressing M again toggles mute back off",
        afterOff === false,
      );

      // The on-screen tell (`specs/ui.md`). Both directions, because "appears when
      // muted" and "disappears when unmuted" are separate claims — a build that
      // draws the indicator and never clears it satisfies the first and fails the
      // player.
      check.expectGt(
        "muting draws a tell in the bottom HUD strip (RGB distance from unmuted)",
        colorDistance(stripOn, stripBefore),
        TELL_MIN,
      );
      check.expectLt(
        "un-muting clears it again (RGB distance back to unmuted)",
        colorDistance(stripOff, stripBefore),
        TELL_MIN,
      );
    },
  };
}
