// Automated validation for the Controls sub-item `no-autorepeat-flip`.
//
// Holding the flip key flips the band exactly once, not repeatedly, so a held key
// does not flap the band back and forth. The flip key is pressed down and held
// (never released) while the real sim steps; the band flips once and then stays put.

import { startClean, LEAD_IN_TICKS } from "../_helpers.mjs";

const band = async (api) => (await api.snapshot()).ship.band;

// Long enough that an autorepeating build would have flapped the band several times
// over — an autorepeat would fire many times a second, so half a second of holding
// is decisive.
const HOLD_TICKS = 60; // 60 ticks = the old 0.5 s

// A beat on the ship's STARTING band before the key goes down.
//
// The check is about a color that changes exactly once, and the old script pressed
// the key on the clip's first frame — so the recording opened on a ship that had
// already flipped and the reviewer had nothing to compare it against. Every other
// one-press item in this case opens with `LEAD_IN_TICKS` for exactly this reason;
// this one was missing it. Doubled here because the whole judgement is "the color
// before" against "the color after", and the before needs to register.
const BEFORE_TICKS = LEAD_IN_TICKS * 2; // 1.2 s of the cyan ship

export default function item() {
  // The band the instant the key went down, and after holding it.
  let onPress;
  let afterHold;

  return {
    id: "controls.no-autorepeat-flip",

    // A live stage-1 wave with the ship on a known band. The wave is kept so the
    // clip shows a held key against live play (nothing on the field is asserted on).
    async arrange(api) {
      await startClean(api, { clear: false });
      await api.call("setShipBand", "cyan");
    },

    async act(api) {
      // A beat on the ship as it starts, so the flip has a visible "before".
      await api.advance(BEFORE_TICKS);

      await api.call("keyDown", "KeyF"); // held down, never released
      onPress = await band(api); // the flip is instant, so read it immediately

      // Keep holding while the sim runs: the band must not flap back.
      await api.advance(HOLD_TICKS);
      afterHold = await band(api);

      await api.call("keyUp", "KeyF");

      // Hold on the flipped ship so the settled color is as readable as the one it
      // started on. Both operands are already captured.
      await api.advance(BEFORE_TICKS);
    },

    async assert(api, check) {
      check.expectEq("the held flip flips the band once", onPress, "magenta");
      check.expectEq(
        "holding the flip does not flip it again",
        afterHold,
        "magenta",
      );
    },
  };
}
