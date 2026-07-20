// Automated validation for the Controls sub-item `fire`.
//
// The fire key (Space, or Up / W) fires a bullet of the ship's current band. Each
// binding is held briefly through injected input; the real fire code, stepped
// forward, spawns a friendly bullet of the ship's band, read back from snapshot().

import { startClean, friendlyBullets, clip } from "../_helpers.mjs";

async function fireWith(api, check, code) {
  await startClean(api);
  await api.call("setShipBand", "cyan");
  await api.call("keyDown", code);
  await api.step(0.05);
  await api.call("keyUp", code);
  const bullets = friendlyBullets(await api.snapshot());
  check.expectGt(`${code} fires a bullet`, bullets.length, 0);
  if (bullets.length > 0) {
    check.expectEq(`${code} fires a bullet of the ship's band`, bullets[0].band, "cyan");
  }
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.fire");
  await fireWith(api, check, "Space");
  await fireWith(api, check, "ArrowUp");
  await fireWith(api, check, "KeyW");

  await startClean(api);
  await api.call("keyDown", "Space");
  await clip(api, 900);
  await api.call("keyUp", "Space");
  return check.verdict();
}
