// Automated validation for targeting.strongest: under `strongest` a firing component aims at
// the unit with the most remaining HP.
//
// A high-HP Slug and a low-HP Cluster are colocated (so only HP distinguishes them); the
// single-target Emitter's first shot must land on the Slug and leave the Cluster untouched.

import { poseHpTargets, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("targeting.strongest");

  const { slug, cluster, slugHp0, clHp0 } = await poseHpTargets(api, "strongest");
  check.expectLt("the strongest (highest-HP) unit was hit", slug.hp, slugHp0);
  check.expectEq("...and the weaker unit was not", cluster.hp, clHp0);

  await liveClip(api);
  return check.verdict();
}
