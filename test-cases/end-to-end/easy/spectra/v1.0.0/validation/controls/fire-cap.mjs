// Automated validation for the Controls sub-item `fire-cap`.
//
// No more than three of your bullets are alive at once, however long fire is held.
// Fire is held and the real sim stepped through a long window; the live friendly
// count is watched and must reach — but never exceed — the cap of three.

import { startClean, friendlyBullets, PBULLET_CAP, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.fire-cap");

  await startClean(api);
  await api.call("setShipX", 640);
  await api.call("keyDown", "Space");

  let maxLive = 0;
  for (let i = 0; i < 70; i += 1) {
    await api.step(0.02);
    maxLive = Math.max(maxLive, friendlyBullets(await api.snapshot()).length);
  }
  await api.call("keyUp", "Space");

  check.expectLe("live player bullets never exceed the cap", maxLive, PBULLET_CAP);
  check.expectGe("held fire reaches the cap", maxLive, PBULLET_CAP);

  await startClean(api);
  await api.call("keyDown", "Space");
  await clip(api, 900);
  await api.call("keyUp", "Space");
  return check.verdict();
}
