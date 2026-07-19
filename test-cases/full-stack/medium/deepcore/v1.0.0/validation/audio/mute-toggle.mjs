// Automated validation for audio.mute-toggle — the mute control toggles the audio mute state on and
// off. We read the muted flag before and after pressing the mute key.

import { press } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("audio.mute-toggle");

  await api.reset({ seed: 1 });
  check.expectEq("mute starts off", (await api.snapshot()).muted, false);

  await press(api, "KeyM");
  check.expectEq("the mute key turns mute on", (await api.snapshot()).muted, true);
  await api.wait(150);
  await api.screenshot("muted");

  await press(api, "KeyM");
  check.expectEq("the mute key turns mute off again", (await api.snapshot()).muted, false);

  return check.verdict();
}
