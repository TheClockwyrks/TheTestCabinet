// Automated validation for the Controls sub-item `mute-key`.
//
// Pressing M toggles the mute state. A round is started (mute off), a single M press
// flips the snapshot's `muted` flag on, and the key flows through the real key
// handling.
//
// WHY THIS RUNS IN A ROUND, AND WHY TWO STILLS. Mute is an audio state, and a
// screenshot cannot hear anything — so the only way a still is evidence at all is if
// the build DRAWS the state, which `specs/ui.md` requires it to: a mute indicator in
// the HUD that tells the two states apart from the board alone. That indicator lives on the
// board, so this item has to be in a round to photograph it; an earlier revision
// captured the title screen, where the spec requires no indicator at all and the two
// pictures a reviewer was asked to compare were therefore identical whatever the build
// did. Shooting BEFORE and AFTER the press, in play, makes the pair mean something:
// the difference between them IS the indicator appearing.
//
// The flag remains what the verdict is decided on. The two stills are the reviewer's
// half — they show the state was drawn, which is a matter of craft the checklist
// leaves to a person, while the assertions below score the toggle itself.

import { actSettleShot, beginRound } from "../_helpers.mjs";

export default function item() {
  // The state either side of the press, checked by `assert`.
  let before;
  let after;

  return {
    id: "controls.mute-key",

    async arrange(api) {
      // A live round, so the HUD — and the mute indicator the spec puts in it — is on
      // screen for both stills.
      await beginRound(api);
    },

    async act(api) {
      // settleMs 150 = a real repaint pause in both passes, not simulation time, so the
      // canvas the still captures is the one the posed state produced.
      before = await actSettleShot(api, "unmuted", { settleMs: 150 });

      await api.call("press", "KeyM");

      after = await actSettleShot(api, "muted", { settleMs: 150 });
    },

    async assert(api, check) {
      // Both stills have to be of the board, or the pair shows a menu twice and the
      // indicator was never in frame to be compared.
      check.expectEq("the stills were taken in a live round", before.screen, "playing");
      check.expectEq("mute starts off", before.muted, false);
      check.expectEq("pressing M toggles mute on", after.muted, true);
      check.expectEq(
        "...and the round is still live for the second, so both stills show the HUD",
        after.screen,
        "playing",
      );
    },
  };
}
