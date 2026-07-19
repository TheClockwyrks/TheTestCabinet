// Automated validation (Warhead) for the Armor item `health-medium-2`: a Medium rock takes
// two bullet hits to destroy. A single Medium is posed on an empty field and shot with the
// primary gun until it is gone; the number of hits it took is read back.

import { poseAndDestroy, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("armor.health-medium-2");

  const { hits, snap } = await poseAndDestroy(api, "medium");
  check.expectEq("a Medium rock takes two bullet hits to destroy", hits, 2);
  check.expectEq("destroying it splits it into two Small rocks", snap.rocks.filter((r) => r.size === "small").length, 2);

  await liveClip(api, 700);
  return check.verdict();
}
