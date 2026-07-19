// Automated validation for targeting.last: under `last` a firing component aims at the unit
// least far along the chain (the fresh one), not the advanced one.

import { poseHeadTargets, angleTo, angDiff, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("targeting.last");

  const { t, la, lb } = await poseHeadTargets(api, "last");
  const toAdvanced = angDiff(t.heading, angleTo(t.cx, t.cy, la));
  const toFresh = angDiff(t.heading, angleTo(t.cx, t.cy, lb));
  check.expectLt("under last, the head aims at the unit least far along (the fresh one)", toFresh, toAdvanced);
  check.expectLt("...and closely tracks it", toFresh, 0.25);

  await liveClip(api);
  return check.verdict();
}
