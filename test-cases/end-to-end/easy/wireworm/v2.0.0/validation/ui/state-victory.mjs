// Automated validation for ui.state-victory: the Victory screen is reachable, and the
// debug API captures it. The layout is judged by eye from the capture. The state is
// reached the real way — clearing the worm on level 12.

import { fireAndResolve, setWorm, tileCX } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("ui.state-victory");

  await api.reset({ seed: 1 });
  await api.call("setLevel", 12);
  await api.call("clearField");
  // Low, just above the band: the level-12 worm steps fast enough that a higher
  // segment would wind out of the firing column before the bolt reached it.
  await setWorm(api, [{ c: 20, r: 17 }], 1, 1);
  await api.call("setCursor", tileCX(20), 688);

  const snap = await fireAndResolve(api);
  check.expectEq("the Victory screen is reachable", snap.screen, "victory");

  await api.wait(300);
  await api.screenshot("victory");

  return check.verdict();
}
