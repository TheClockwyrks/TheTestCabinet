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

    // Bank a recognisable balance on a fresh expedition. The save and the return to the title used
    // to happen here too, which meant the clip opened at the title with the save already written:
    // the item is named "Save at the pad, continue from the menu" and its first half was never
    // filmed, so whatever a build shows to confirm a save went through was not in the evidence.
    // Only the balance is posed here now; everything the item claims happens in `act`.
    async arrange(api) {
      await newRun(api);
      await api.call("grantCredits", 777);
    },

    // Both halves are the behavior under test, so both are filmed: the save landing at the pad,
    // then the title, then Continue bringing the expedition back with its balance intact.
    //
    // `reset` is legal here — the runtime hands the build's own clock straight back afterwards, so
    // it means the same thing in both passes and does not freeze the recording.
    async act(api) {
      await api.advance(45); // 45 ticks = 0.75 s at the surface with the balance banked
      await api.call("save");
      saved = (await api.snapshot()).hasSave;
      await api.advance(75); // 75 ticks = 1.25 s for whatever the build shows on a save

      await api.reset(); // back to the title; the save persists
      title = await api.snapshot();
      await api.advance(60); // 60 ticks = 1 s on the title, where CONTINUE is now offered

      await press(api, "Enter"); // CONTINUE is the first menu entry when a save exists
      resumed = await api.snapshot();
      await api.advance(90); // 90 ticks = 1.5 s on the resumed expedition and its restored balance
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
