// Automated validation for targeting.weakest: under `weakest` a firing component aims at the
// unit with the least remaining HP.
//
// A high-HP Slug and a low-HP Cluster are colocated; the single-target Emitter's first shot
// must land on the Cluster and leave the Slug untouched.

import { poseHpTargets, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("targeting.weakest");

  const { slug, cluster, slugHp0, clHp0 } = await poseHpTargets(api, "weakest");
  check.expectLt("the weakest (lowest-HP) unit was hit", cluster.hp, clHp0);
  check.expectEq("...and the stronger unit was not", slug.hp, slugHp0);

  await liveClip(api);
  return check.verdict();
}
