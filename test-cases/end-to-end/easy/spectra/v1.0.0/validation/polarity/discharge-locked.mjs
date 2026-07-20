// Automated validation for the Polarity sub-item `discharge-locked`.
//
// Below full resonance a discharge does nothing: the meter is not spent and no
// discharge wave fires. The meter is posed one point short of full and a discharge
// triggered; nothing changes.

import { startClean, liveWaveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("polarity.discharge-locked");

  await startClean(api);
  await api.call("setResonance", 99); // one short of full
  await api.call("discharge");
  const snap = await api.snapshot();
  check.expectEq("a below-full discharge does not spend the meter", snap.resonance, 99);
  check.expectOk("no discharge wave fires below full", snap.discharge.active === false);

  await liveWaveClip(api);
  return check.verdict();
}
