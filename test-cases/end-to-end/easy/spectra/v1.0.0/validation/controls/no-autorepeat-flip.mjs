// Automated validation for the Controls sub-item `no-autorepeat-flip`.
//
// Holding the flip key flips the band exactly once, not repeatedly, so a held key
// does not flap the band back and forth. The flip key is pressed down and held
// (never released) while the real sim steps; the band flips once and then stays put.

import { startClean } from "../_helpers.mjs";

const band = async (api) => (await api.snapshot()).ship.band;

// Long enough that an autorepeating build would have flapped the band several times
// over — an autorepeat would fire many times a second, so half a second of holding
// is decisive.
const HOLD_TICKS = 60; // 60 ticks = the old 0.5 s

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
      await api.call("keyDown", "KeyF"); // held down, never released
      onPress = await band(api); // the flip is instant, so read it immediately

      // Keep holding while the sim runs: the band must not flap back.
      await api.advance(HOLD_TICKS);
      afterHold = await band(api);

      await api.call("keyUp", "KeyF");
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
