// Automated validation for the Single Player Controls sub-item `m`.
//
// Pressing M must toggle mute. From the title (mute off), a single M press flips the
// snapshot's `muted` flag on; a title screenshot captures the changed mute hint as
// proof. See validation/_helpers.mjs.

import { muteCheck } from "../_helpers.mjs";

export default async function drive(api) {
  return { verdicts: { "controls-solo.m": await muteCheck(api, "KeyM") } };
}
