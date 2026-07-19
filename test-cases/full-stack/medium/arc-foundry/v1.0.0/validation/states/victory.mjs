// Automated validation for states.victory: clearing the run reaches the Victory screen.
//
// The post-final Overload Dynamo is released with integrity to spare; when it grounds out the
// real finale->win path reaches Victory.

import { startBuild, spawnControlled, snap, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("states.victory");

  await startBuild(api, { difficulty: "easy" });
  await api.call("setIntegrity", 999);
  await spawnControlled(api, "overload");

  await liveClip(api, 2000);
  await api.call("setAutoStep", false);

  const r = await stepUntil(api, (s) => s.screen === "victory", 150, 0.5);
  check.expectOk("the run reaches Victory", r.hit);
  check.expectEq("the Victory screen shows", (await snap(api)).screen, "victory");

  await api.screenshot("victory");
  return check.verdict();
}
