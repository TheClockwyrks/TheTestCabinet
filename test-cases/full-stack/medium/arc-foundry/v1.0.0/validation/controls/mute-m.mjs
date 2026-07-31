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

import { startBuild, snap } from "../_helpers.mjs";

// A paint settle so the status bar has drawn its mute control before and after the toggle —
// the still is read from a rendered frame, and no amount of stepping paints one.
const SETTLE_MS = 120;

export default function item() {
  // The mute flag either side of the press, read by `assert`.
  let before;
  let after;

  return {
    id: "controls.mute-m",

    async arrange(api) {
      await startBuild(api);
    },

    async act(api) {
      await api.settle(SETTLE_MS);
      before = (await snap(api)).muted;

      await api.call("press", "KeyM");
      await api.settle(SETTLE_MS);
      after = (await snap(api)).muted;

      await api.screenshot("mute");
    },

    async assert(api, check) {
      check.expectEq("mute starts off", before, false);
      check.expectEq("pressing M toggles mute on", after, true);
    },
  };
}
