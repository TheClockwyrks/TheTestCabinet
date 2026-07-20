// Automated validation for controls.mute-m: pressing M toggles audio mute.

import { snap } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.mute-m");

  await api.reset();
  await api.wait(80);
  const before = (await snap(api)).muted;
  await api.call("press", "KeyM");
  const after = (await snap(api)).muted;

  check.expectEq("mute starts off", before, false);
  check.expectEq("pressing M toggles mute on", after, true);

  await api.screenshot("mute");
  return check.verdict();
}
