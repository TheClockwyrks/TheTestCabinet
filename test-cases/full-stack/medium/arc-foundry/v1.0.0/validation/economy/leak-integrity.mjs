// Automated validation for economy.leak-integrity: a unit that grounds out at the Collector
// costs the player its leak value in Grid Integrity (a Slug leaks 2).
//
// A Slug is released with no towers to stop it; when it reaches the Collector the integrity
// must fall by exactly the Slug's leak value.

import { startBuild, spawnControlled, snap, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("economy.leak-integrity");

  await startBuild(api);
  await api.call("setIntegrity", 50);
  const i0 = (await snap(api)).integrity;

  await spawnControlled(api, "slug");
  await liveClip(api, 2500); // a clip of the slug crawling the maze
  await api.call("setAutoStep", false);

  const r = await stepUntil(api, (s) => s.integrity < i0 || s.screen !== "playing", 150, 0.5);
  const i1 = (await snap(api)).integrity;

  check.expectOk("the Slug reached the Collector", r.hit);
  check.expectEq("the leak cost the Slug's leak value (2 Grid Integrity)", i0 - i1, 2);

  return check.verdict();
}
