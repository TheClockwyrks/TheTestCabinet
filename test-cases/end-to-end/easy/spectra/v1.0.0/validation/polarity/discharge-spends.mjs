// Automated validation for the Polarity sub-item `discharge-spends`.
//
// Firing a discharge spends the entire resonance meter, dropping it to zero. The
// meter is filled, a REAL discharge fired, and the meter read back.

import { startClean, liveWaveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("polarity.discharge-spends");

  await startClean(api);
  await api.call("setResonance", 100);
  check.expectEq("the meter is full before the discharge", (await api.snapshot()).resonance, 100);
  await api.call("discharge");
  const snap = await api.snapshot();
  check.expectEq("a discharge spends the whole meter", snap.resonance, 0);
  check.expectOk("the discharge wave is live", snap.discharge.active === true);

  await liveWaveClip(api);
  return check.verdict();
}
