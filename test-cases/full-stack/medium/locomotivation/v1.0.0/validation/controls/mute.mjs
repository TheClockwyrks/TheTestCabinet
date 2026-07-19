// Controls: M toggles the mute flag. From the title (mute off) a single M press flips it
// on; a title screenshot captures the changed mute hint.

import { settle } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.mute");

  await api.reset();
  check.expectEq("mute starts off at the title", (await api.snapshot()).muted, false);
  await api.call("press", "KeyM");
  check.expectEq("pressing M toggles mute on", (await api.snapshot()).muted, true);

  await settle(api, 150);
  await api.screenshot("shot");
  return check.verdict();
}
