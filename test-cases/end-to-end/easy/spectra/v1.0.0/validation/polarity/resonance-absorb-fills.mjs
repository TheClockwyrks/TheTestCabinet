// Automated validation for the Polarity sub-item `resonance-absorb-fills`.
//
// Absorbing a same-band enemy bullet feeds the resonance meter (about 6 of 100 per
// bullet). The meter is zeroed as a precondition; one same-band bullet is absorbed
// by the real shield, and the resonance gain is read back.

import {
  startClean,
  shieldBullet,
  stepUntil,
  RES_ABSORB,
  liveWaveClip,
} from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("polarity.resonance-absorb-fills");

  await startClean(api);
  await api.call("setShipBand", "cyan");
  await api.call("setResonance", 0);
  await shieldBullet(api, "cyan");
  const r = await stepUntil(api, (s) => s.resonance > 0, 0.3);
  check.expectOk("absorbing a bullet raises resonance", r.hit);
  check.expectClose(
    "one absorbed bullet adds about 6 resonance",
    r.snap.resonance,
    RES_ABSORB,
    0.01,
  );

  await liveWaveClip(api);
  return check.verdict();
}
