// Automated validation for the Controls sub-item `flip-key`.
//
// The flip key (F, or either Shift) flips the ship's band. Each binding is pressed
// through injected input and the resulting band read back — the same flip the game
// uses, through the real key handling.

import { startClean } from "../_helpers.mjs";

const band = async (api) => (await api.snapshot()).ship.band;

// Ticks held between presses. Nothing about a flip needs time — each band below is
// read the instant its press lands — but the presses are otherwise back-to-back in
// the same frame, which would film as a single flicker. A beat between them lets the
// reviewer see three distinct flips.
const BEAT_TICKS = 36;

export default function item() {
  // The band after each of the three bindings' presses.
  let afterF;
  let afterShiftLeft;
  let afterShiftRight;

  return {
    id: "controls.flip-key",

    // A live stage-1 wave, its swarm kept, with the ship posed on a known band so
    // each flip's result is unambiguous. The wave is kept so the clip shows the
    // flips against live play — which is when a player actually flips — rather than
    // an empty field. Nothing on the field is read by the assertions.
    async arrange(api) {
      await startClean(api, { clear: false });
      await api.call("setShipBand", "cyan");
    },

    async act(api) {
      await api.call("press", "KeyF");
      afterF = await band(api); // read the instant the press lands: a flip is not timed
      await api.advance(BEAT_TICKS);

      await api.call("press", "ShiftLeft");
      afterShiftLeft = await band(api);
      await api.advance(BEAT_TICKS);

      await api.call("press", "ShiftRight");
      afterShiftRight = await band(api);
      await api.advance(BEAT_TICKS);
    },

    async assert(api, check) {
      check.expectEq("F flips the band", afterF, "magenta");
      check.expectEq("Left Shift flips the band", afterShiftLeft, "cyan");
      check.expectEq("Right Shift flips the band", afterShiftRight, "magenta");
    },
  };
}
