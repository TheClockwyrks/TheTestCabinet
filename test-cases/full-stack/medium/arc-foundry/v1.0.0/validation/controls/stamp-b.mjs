// Automated validation for controls.stamp-b: pressing B during a build phase pulls the
// scrap-press, arming a blank rock on the cursor; it can then be placed.

import { startBuild, snap, spawnControlled, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.stamp-b");

  await startBuild(api);
  await api.call("press", "KeyB");
  const s1 = await snap(api);
  check.expectOk("pressing B armed a rock (the press pulled)", !!s1.held && s1.held.active);

  // The armed rock can then be placed with a click on a legal footprint.
  await api.call("pointerMove", 120, 260);
  await api.call("click", 120, 260);
  const s2 = await snap(api);
  check.expectGt("the armed rock is then placeable", s2.towers.filter((t) => t.kind === "candidate").length, 0);

  await spawnControlled(api, "spark");
  await liveClip(api);
  return check.verdict();
}
