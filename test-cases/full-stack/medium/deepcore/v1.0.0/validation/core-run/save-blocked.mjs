// Automated validation for core-run.save-blocked.
//
// The Save Pad refuses to save while the unstable Core Sample's timer is running. We try to save
// while carrying a live Sample (must be refused), then — as a control — start fresh with no Sample
// and confirm a normal save succeeds.

import { newRun, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("core-run.save-blocked");

  // Blocked: a live Sample must prevent the save.
  await newRun(api); // clears any save, miner on the surface
  await api.call("spawnCoreSample");
  await api.call("save");
  check.expectEq("saving is refused while a Sample is live", (await api.snapshot()).hasSave, false);

  // Control: with no Sample, a surface save succeeds — proving the save path itself works.
  await api.call("startExpedition", "standard"); // fresh expedition, no Sample, save cleared
  await api.call("save");
  check.expectEq("a normal surface save succeeds", (await api.snapshot()).hasSave, true);

  await liveClip(api, 500);
  return check.verdict();
}
