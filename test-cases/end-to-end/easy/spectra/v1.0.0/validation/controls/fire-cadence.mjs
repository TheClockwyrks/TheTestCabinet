// Automated validation for the Controls sub-item `fire-cadence`.
//
// Held fire spaces shots by a fire cadence of about 0.16s rather than firing every
// frame. Fire is held and the real sim stepped in fixed increments; the times of
// the first and second shots are read from the friendly-bullet count and their gap
// checked against the cadence.

import { startClean, friendlyBullets, FIXED, FIRE_CADENCE, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.fire-cadence");

  await startClean(api);
  await api.call("setShipX", 640);
  await api.call("keyDown", "Space");

  let t = 0;
  let t1 = null;
  let t2 = null;
  for (let i = 0; i < 100 && t2 === null; i += 1) {
    await api.step(FIXED);
    t += FIXED;
    const n = friendlyBullets(await api.snapshot()).length;
    if (t1 === null && n >= 1) t1 = t;
    else if (t1 !== null && n >= 2) t2 = t;
  }
  await api.call("keyUp", "Space");

  check.expectOk("two shots were fired while holding", t1 !== null && t2 !== null);
  if (t1 !== null && t2 !== null) {
    check.expectClose("consecutive shots are spaced by the fire cadence", t2 - t1, FIRE_CADENCE, 0.02);
  }

  await startClean(api);
  await api.call("keyDown", "Space");
  await clip(api, 900);
  await api.call("keyUp", "Space");
  return check.verdict();
}
