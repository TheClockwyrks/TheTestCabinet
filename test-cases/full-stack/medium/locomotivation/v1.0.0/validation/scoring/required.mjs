// Scoring: each required (dispenser/unique) delivery adds its base points. A red dispenser
// package is delivered for real into the red zone; the required score component rises by 100.

import { setTile, startFresh, DT, SCORE, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("scoring.required");

  await startFresh(api, 1);
  await api.call("givePackage", { color: "red", weightClass: "parcel", archetype: "dispenser" });

  await setTile(api, 4, 2); // the red zone
  await api.step(DT);
  const snap = await api.snapshot();
  check.expectEq("the required-delivery score component is added", snap.level.scoreParts.required, SCORE.required);
  check.expectGe("the total score reflects the delivery", snap.level.score, SCORE.required);

  await liveClip(api, 500);
  return check.verdict();
}
