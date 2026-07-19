// Automated validation for the Controls item `mute-m`: the M key toggles mute. From the
// title (mute off), a single M press must flip the mute state on; the title is captured
// showing the changed mute hint.

import { title } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.mute-m");

  await title(api);
  check.expectEq("mute starts off", (await api.snapshot()).muted, false);

  await api.call("press", "KeyM");
  check.expectEq("pressing M toggles mute on", (await api.snapshot()).muted, true);

  await api.wait(160); // let the title redraw with the new mute hint
  await api.screenshot("mute");
  return check.verdict();
}
