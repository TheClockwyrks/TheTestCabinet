// Scoring: an optional delivery is worth more than a required one — the greed reward. On
// level 2 an optional amber and a required red are each delivered for real; the optional
// component (per delivery) exceeds the required one.

import { setTile, startFresh, DT, SCORE, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("scoring.optional");

  await startFresh(api, 2);

  await api.call("givePackage", { color: "amber", weightClass: "parcel", archetype: "optional" });
  await setTile(api, 15, 3); // amber (optional) zone
  await api.step(DT);
  const afterOptional = await api.snapshot();
  check.expectEq("the optional delivery scores its value", afterOptional.level.scoreParts.optional, SCORE.optional);

  await api.call("givePackage", { color: "red", weightClass: "parcel", archetype: "dispenser" });
  await setTile(api, 30, 1); // red zone
  await api.step(DT);
  const afterRequired = await api.snapshot();
  check.expectEq("the required delivery scores its value", afterRequired.level.scoreParts.required, SCORE.required);
  check.expectGt("an optional is worth more than a required delivery", SCORE.optional, SCORE.required);

  await liveClip(api, 500);
  return check.verdict();
}
