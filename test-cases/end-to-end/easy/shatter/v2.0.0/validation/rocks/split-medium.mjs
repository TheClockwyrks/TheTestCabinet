// Automated validation for the Rocks item `split-medium`: destroying a Medium rock
// yields two Small rocks. A single Medium is posed on an empty field and shot until
// destroyed; the field is then read for the two Small fragments.

import { poseAndDestroy, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("rocks.split-medium");

  const { snap } = await poseAndDestroy(api, "medium");
  const smalls = snap.rocks.filter((r) => r.size === "small");
  const mediums = snap.rocks.filter((r) => r.size === "medium");

  check.expectEq("the Medium rock is gone once destroyed", mediums.length, 0);
  check.expectEq("a destroyed Medium yields exactly two Small rocks", smalls.length, 2);

  await liveClip(api, 700);
  return check.verdict();
}
