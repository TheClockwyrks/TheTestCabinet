// Automated validation (Warhead) for the Armor item `health-small-1`: a Small rock takes a
// single bullet hit to destroy. A single Small is posed on an empty field and shot with the
// primary gun until it is gone; the number of hits it took is read back.

import { poseAndDestroy, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("armor.health-small-1");

  const { hits, snap } = await poseAndDestroy(api, "small");
  check.expectEq("a Small rock takes one bullet hit to destroy", hits, 1);
  check.expectEq("a destroyed Small leaves no fragments", snap.rocks.length, 0);

  await liveClip(api, 600);
  return check.verdict();
}
