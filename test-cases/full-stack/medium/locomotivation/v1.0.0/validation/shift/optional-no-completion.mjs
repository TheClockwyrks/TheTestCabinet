// Shift: delivering an optional package changes only the score — it never satisfies the
// quota nor fails the shift. An optional amber is carried into the amber zone on level 2;
// the optional tally rises but the shift keeps playing with the quota unmet.

import { setTile, startFresh, DT, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("shift.optional-no-completion");

  await startFresh(api, 2);
  await api.call("givePackage", { color: "amber", weightClass: "parcel", archetype: "optional" });

  await setTile(api, 15, 3); // the amber (optional) zone
  await api.step(DT);
  const snap = await api.snapshot();
  check.expectEq("the optional delivery is tallied", snap.level.optionalsDelivered, 1);
  check.expectEq("the shift is still playing", snap.phase, "playing");
  check.expectEq("the required quota is not met by an optional", snap.level.quotaMet, false);

  await liveClip(api, 600);
  return check.verdict();
}
