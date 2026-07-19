// Automated validation for economy.overload-at-zero: when Grid Integrity is driven to 0 by a
// leak the run overloads and ends (the Overload/defeat screen), even mid-wave.
//
// Integrity is set to 1 and a Slug (leak 2) released; when it grounds out integrity falls
// below zero and the run overloads.

import { startBuild, spawnControlled, snap, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("economy.overload-at-zero");

  await startBuild(api);
  await api.call("setIntegrity", 1);
  await spawnControlled(api, "slug");

  await liveClip(api, 2500); // the slug crawling toward the sink
  await api.call("setAutoStep", false);

  const r = await stepUntil(api, (s) => s.screen === "overload", 150, 0.5);
  check.expectOk("the run overloaded when Grid Integrity hit zero", r.hit);
  check.expectEq("the screen is the Overload (defeat) screen", (await snap(api)).screen, "overload");

  return check.verdict();
}
