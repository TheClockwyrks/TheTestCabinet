// Automated validation for the Controls sub-item `pause`.
//
// A pause key (Esc, or P) pauses a live wave. Each binding is pressed through
// injected input during a live wave and the resulting paused screen read back.

import { startClean } from "../_helpers.mjs";

export default function item() {
  // The screen each binding produced.
  let afterEsc;
  let afterP;

  return {
    id: "controls.pause",

    // A live stage-1 wave with its swarm kept, so the pause lands over actual play —
    // which is both the scenario the check describes and what makes the clip legible.
    async arrange(api) {
      await startClean(api, { clear: false });
    },

    async act(api) {
      // Let some of the wave fly in, so the pause is visibly over a live field.
      await api.advance(60); // 60 ticks (0.5 s) = the old clip's lead-in

      await api.call("press", "Escape");
      afterEsc = (await api.snapshot()).screen; // pausing is instant: read it now
      await api.advance(48); // hold on the paused screen so it is readable

      // The old script reset between the two bindings to get back to a live wave.
      // `reset` is forbidden in `act` (it would take the clock back and freeze the
      // recording), but no reset is needed: a pause key toggles, so pressing Esc
      // again resumes the very same wave and leaves P a live wave to pause.
      await api.call("press", "Escape");
      await api.advance(60); // play resumes for a beat

      await api.call("press", "KeyP");
      afterP = (await api.snapshot()).screen;
      await api.advance(48); // hold on the paused screen again
    },

    async assert(api, check) {
      check.expectEq("Esc pauses the wave", afterEsc, "paused");
      check.expectEq("P pauses the wave", afterP, "paused");
    },
  };
}
