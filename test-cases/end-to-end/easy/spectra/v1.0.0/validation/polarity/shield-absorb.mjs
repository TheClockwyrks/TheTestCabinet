// Automated validation for the Polarity sub-item `shield-absorb`.
//
// Your current band is your shield: a same-band enemy bullet is absorbed on
// contact, costing no life. The ship's band and lives are posed; a same-band enemy
// bullet is sent onto the ship, and the real shield resolves the contact.

import { startClean, shieldBullet, stepUntil, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("polarity.shield-absorb");

  await startClean(api);
  await api.call("setShipBand", "cyan");
  await api.call("setLives", 3);
  await api.call("setResonance", 0);
  await shieldBullet(api, "cyan"); // same band as the ship
  // The absorb resolves the moment the bullet reaches the ship.
  const r = await stepUntil(api, (s) => s.resonance > 0, 0.3);
  check.expectOk("the same-band bullet is absorbed (resonance rises)", r.hit);
  check.expectEq("no life is lost on a same-band bullet", r.snap.lives, 3);

  await clip(api, 1000);
  return check.verdict();
}
