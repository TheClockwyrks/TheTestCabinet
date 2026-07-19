// Cargo: a pickup that would push the load past the weight cap is refused. The worker
// already carries a "load" (80 of 120); a real E press at a ground "load" (80) would
// total 160 > 120, so the pickup is denied and the package stays on the ground.

import { pressStep, setTile, startFresh, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("cargo.pickup-cap");

  await startFresh(api, 1);
  await setTile(api, 10, 12);
  await api.call("givePackage", { color: "red", weightClass: "load", archetype: "dispenser" });
  await api.call("spawnGroundPackage", { col: 10, row: 12, color: "blue", weightClass: "load", archetype: "optional" });

  await pressStep(api, "KeyE");
  const snap = await api.snapshot();
  check.expectEq("the over-cap pickup is refused (still carrying one)", snap.worker.carried.length, 1);
  check.expectEq("the refused package stays on the ground", snap.ground.length, 1);

  await liveClip(api, 600);
  return check.verdict();
}
