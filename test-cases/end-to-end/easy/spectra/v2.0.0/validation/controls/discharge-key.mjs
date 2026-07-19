// Automated validation for the Controls sub-item `discharge-key`.
//
// The discharge key (X) fires a discharge when the resonance meter is full. The
// meter is posed full and X pressed through injected input; the real discharge
// fires, spending the meter and starting the wave, read back from snapshot().

import { startClean, liveWaveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.discharge-key");

  await startClean(api);
  await api.call("setResonance", 100);
  await api.call("press", "KeyX");
  const snap = await api.snapshot();
  check.expectEq("X spends the full meter on a discharge", snap.resonance, 0);
  check.expectOk("X fires the discharge wave", snap.discharge.active === true);

  await liveWaveClip(api);
  return check.verdict();
}
