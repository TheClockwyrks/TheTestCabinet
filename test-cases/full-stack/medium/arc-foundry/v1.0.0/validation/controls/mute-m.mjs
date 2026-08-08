// Automated validation for controls.mute-m: pressing M toggles audio mute.
//
// Opening a run is the arrange; the M KEY PRESS and the reads either side of it are the act.
//
// WHERE M IS DRIVEN. This used to press M on the TITLE screen: `arrange` was a bare `reset`,
// which returns the game to its initial title state (`specs/instrumentation.md`), and nothing
// started a run. Mute is a HUD control — `specs/ui.md` puts it in the status bar and
// `specs/controls.md` lists it among the accelerators alongside it — and the status bar only
// exists on the board. Whether a build also answers M on its menus is its own business, and
// this item is not the place to decide it, so the binding is driven where the spec plainly
// requires it: during play.
//
// WHY THE STATUS BAR IS SAMPLED AS WELL AS THE FLAG. Reading `muted` out of the snapshot proves
// the key reached the audio system; it proves nothing about the player being told. `specs/ui.md`
// puts a mute control in the status bar and requires it to read its current state, so that muting
// "must therefore change what the bar draws" — and a build can flip the flag correctly while
// drawing nothing at all, which is what one run implementation does: `M` works, the snapshot
// agrees, and there is no way to tell from the screen whether the game is muted. That build passed
// this item.
//
// So the control is sampled either side of the press and the two must differ. The build reports
// the control's own rectangle through `statusControls()` (`specs/instrumentation.md`), so the
// sweep lands wherever this build drew it and is dense enough over those few dozen pixels to be
// conclusive — see `controlSignature` for why sweeping the whole bar instead could not be.
//
// The reported `state` is checked against the snapshot's `muted` too: `specs/ui.md` requires the
// control to read its own current state, so a build whose bar reports one thing while the game
// believes another is drawing a control that lies.
//
// The two stills are the same comparison for the reviewer: the bar unmuted, and the bar muted.

import { startBuild, statusControl, controlSignature, signatureDiff, snap } from "../_helpers.mjs";

// A paint settle so the status bar has drawn its mute control before and after the toggle —
// the still is read from a rendered frame, and no amount of stepping paints one.
const SETTLE_MS = 120;

export default function item() {
  // The mute flag, the reported control, and what it DREW, either side of the press.
  let before;
  let after;
  let ctrlBefore;
  let ctrlAfter;
  let pixBefore;
  let pixAfter;

  return {
    id: "controls.mute-m",

    async arrange(api) {
      await startBuild(api);
    },

    async act(api) {
      await api.settle(SETTLE_MS);
      before = (await snap(api)).muted;
      ctrlBefore = await statusControl(api, "mute");
      pixBefore = await controlSignature(api, ctrlBefore);
      await api.screenshot("unmuted");

      await api.call("press", "KeyM");
      await api.settle(SETTLE_MS);
      after = (await snap(api)).muted;
      ctrlAfter = await statusControl(api, "mute");
      pixAfter = await controlSignature(api, ctrlAfter);
      await api.screenshot("muted");
    },

    async assert(api, check) {
      check.expectEq("mute starts off", before, false);
      check.expectEq("pressing M toggles mute on", after, true);

      // ...and the player can see it. The status bar carries a mute control (`specs/ui.md`),
      // it reads its own state, and that state has to agree with the game's.
      check.expectOk("the status bar carries a mute control", Boolean(ctrlBefore && ctrlAfter));
      check.expectEq("...reading unmuted before the press", ctrlBefore?.state, false);
      check.expectEq("...and muted after it", ctrlAfter?.state, true);

      // And it must LOOK different, not merely report differently — a control that reads its own
      // state and draws the same either way tells the player nothing.
      check.expectGt(
        `the control visibly changes (${pixBefore.length} px sampled inside its own rectangle)`,
        signatureDiff(pixBefore, pixAfter),
        0,
      );
    },
  };
}
