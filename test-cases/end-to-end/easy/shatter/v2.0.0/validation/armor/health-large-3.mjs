// Automated validation (Warhead) for the Armor item `health-large-3`: a Large rock takes
// three bullet hits to destroy. A single Large is posed on an empty field and shot with the
// primary gun until it is gone; the number of hits it took is read back.

import { poseAndDestroy, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("armor.health-large-3");

  const { hits, snap } = await poseAndDestroy(api, "large");
  check.expectEq("a Large rock takes three bullet hits to destroy", hits, 3);
  check.expectEq("destroying it splits it into two Medium rocks", snap.rocks.filter((r) => r.size === "medium").length, 2);

  await liveClip(api, 700);
  return check.verdict();
}
