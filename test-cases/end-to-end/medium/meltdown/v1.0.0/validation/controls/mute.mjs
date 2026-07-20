// Automated validation for the Controls sub-item `mute`.
//
// M toggles mute on any screen (specs/controls.md). From the title (mute off) a
// single M press flips it on.

import { press } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.mute");

  await api.reset();
  check.expectEq("mute starts off", (await api.snapshot()).muted, false);
  await press(api, "KeyM");
  check.expectEq("M toggles mute on", (await api.snapshot()).muted, true);

  await api.wait(120);
  await api.screenshot("mute");
  return check.verdict();
}
