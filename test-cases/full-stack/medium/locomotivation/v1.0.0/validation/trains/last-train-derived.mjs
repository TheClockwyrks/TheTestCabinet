// Trains: the optional last train's spawn time is DERIVED from its path length and speed
// (t_spawn = clock − (P + L) / v), so its tail clears the map exactly as the clock ends.
// Level 3's last train is a westbound freight; we confirm it is absent early, present late,
// and that its inferred spawn time matches the derivation.

import { startFresh, lastTrain, TRAIN, VIEW_W, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("trains.last-train-derived");

  // Level 3's last-train consist and the derived spawn time.
  const carLen = { engine: 80, boxcar: 80, "flat-top": 80, "flat-top-half": 40 };
  const consist = ["engine", "boxcar", "flat-top", "boxcar", "flat-top-half", "flat-top"];
  const L = consist.reduce((s, c) => s + carLen[c], 0); // 440
  const v = TRAIN.freight.speed; // 90
  const clock = 110;
  const derivedSpawn = clock - (VIEW_W + L) / v; // ~90.889

  await startFresh(api, 3);
  await api.step(80); // well before the derived spawn
  check.expectOk("no last train before its derived window", !lastTrain(await api.snapshot()));

  await api.step(15); // t = 95, after the derived spawn
  const snap = await api.snapshot();
  const lt = lastTrain(snap);
  check.expectOk("the last train has arrived after its derived window", !!lt);
  if (lt) {
    const inferredSpawn = snap.simTime - lt.headPos / lt.speed;
    check.expectClose("the inferred spawn time matches the derivation", inferredSpawn, derivedSpawn, 0.6);
  }

  await liveClip(api, 900);
  return check.verdict();
}
