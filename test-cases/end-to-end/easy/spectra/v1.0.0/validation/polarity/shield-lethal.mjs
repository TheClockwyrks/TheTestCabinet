// Automated validation for the Polarity sub-item `shield-lethal`.
//
// An enemy bullet of the band OPPOSITE the ship's is not shielded: it costs a
// life. The ship's band and lives are posed; an opposite-band bullet is sent onto
// the ship, and the real shield resolves it into a lost life.

import { startClean, shieldBullet, stepUntil, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("polarity.shield-lethal");

  await startClean(api);
  await api.call("setShipBand", "cyan");
  await api.call("setLives", 3);
  await shieldBullet(api, "magenta"); // opposite the ship's band
  const r = await stepUntil(api, (s) => s.lives < 3, 0.3);
  check.expectOk("an opposite-band bullet costs a life", r.hit);
  check.expectEq("a life is lost on the opposite-band bullet", r.snap.lives, 2);

  await clip(api, 1000);
  return check.verdict();
}
