// Automated validation for rocket.launch-victory.
//
// With all five components installed, launching takes the game to Victory — the only win. We supply
// the Credits, both materials, and the Core Sample, fabricate all five, launch, and step through the
// launch sequence.

import { newRun, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("rocket.launch-victory");

  await newRun(api);
  await api.call("grantCredits", 20000);
  await api.call("giveMaterial", "resonite");
  await api.call("giveMaterial", "cryenite");
  await api.call("spawnCoreSample");
  for (let i = 0; i < 5; i += 1) await api.call("fabricate");
  check.expectEq("all five components are installed", (await api.snapshot()).rocket.installed.length, 5);

  await api.call("launch");
  await api.step(3); // the launch sequence resolves to Victory
  const snap = await api.snapshot();
  check.expectEq("launching wins the game", snap.screen, "victory");
  check.expectOk("a run summary is shown", !!snap.summary);

  await liveClip(api, 700);
  return check.verdict();
}
