// Automated validation for the Multi Player Controls sub-item `m`.
//
// Pressing M must toggle mute. From the title (mute off), a single M press flips the
// snapshot's `muted` flag on. See validation/_helpers.mjs.

import { muteToggle } from "../_helpers.mjs";

export default async function drive(api) {
  const { before, after } = await muteToggle(api, "KeyM");
  const pass = before === false && after === true;
  return {
    verdicts: { "controls-versus.m": pass },
    notes: { "controls-versus.m": `muted ${before} -> ${after} after pressing M` },
  };
}
