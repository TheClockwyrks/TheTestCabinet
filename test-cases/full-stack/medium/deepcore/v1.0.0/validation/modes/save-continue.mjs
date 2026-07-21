// Automated validation for modes.save-continue.
//
// Saving at the surface Save Pad writes the single slot, and the main menu's Continue resumes the
// saved expedition exactly. We bank an identifiable Credits balance, save, return to the title, and
// take Continue.

import { newRun, press } from "../_helpers.mjs";

export default function item() {
  let saved;
  let title;
  let resumed;

  return {
    id: "modes.save-continue",

    // Bank a recognisable balance, save it, and come back to the title. The reset is posing (it is
    // how the title is reached) and consumes no time, so it belongs here — `act` may not reset.
    async arrange(api) {
      await newRun(api);
      await api.call("grantCredits", 777);
      await api.call("save");
      saved = (await api.snapshot()).hasSave;

      await api.reset(); // back to the title; the save persists
      title = await api.snapshot();
    },

    // Taking Continue IS the behavior under test, so the press happens here and the clip shows the
    // saved expedition coming back up.
    async act(api) {
      await press(api, "Enter"); // CONTINUE is the first menu entry when a save exists
      resumed = await api.snapshot();
      await api.advance(30); // 30 ticks = 0.5 s, the old 500 ms clip tail
    },

    async assert(api, check) {
      check.expectEq("the expedition is saved", saved, true);
      check.expectEq("the title is up", title.screen, "title");
      check.expectEq("the save is still present", title.hasSave, true);
      check.expectEq(
        "Continue resumes the expedition",
        resumed.screen,
        "in-mine",
      );
      check.expectEq("the saved Credits are restored", resumed.credits, 777);
    },
  };
}
