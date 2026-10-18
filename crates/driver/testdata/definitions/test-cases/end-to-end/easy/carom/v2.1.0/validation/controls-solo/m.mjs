// Automated validation for the Single Player Controls sub-item `m`.
//
// Pressing M must toggle mute. From the title (mute off), a single M press flips the
// snapshot's `muted` flag on; a title screenshot captures the changed mute hint as
// proof.
//
// The reset to the title is instant, so it is `arrange`; the press, the reads either
// side of it, the redraw settle, and the capture are `act` — this item's output is the
// still, and the capture only produces media in the record pass. See
// validation/_helpers.mjs.

import { arrangeTitle, actMuteToggle, assertMute } from "../_helpers.mjs";

export default function item() {
  // The `muted` flag either side of the press, checked by `assert`.
  let toggled;

  return {
    id: "controls-solo.m",

    async arrange(api) {
      await arrangeTitle(api);
    },

    async act(api) {
      toggled = await actMuteToggle(api, { code: "KeyM" });
    },

    async assert(api, check) {
      assertMute(check, toggled, { code: "KeyM" });
    },
  };
}
