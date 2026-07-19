// Automated validation for targeting.first: a firing component defaults to `first` and, under
// it, aims at the unit furthest along the waypoint chain.
//
// The default priority is read off a freshly-armed component. Then two units are posed — one
// advanced (further along), one fresh — and the head, under `first`, must aim at the advanced
// one (closer in angle to it than to the fresh one).

import { armTower, towerById, snap, poseHeadTargets, angleTo, angDiff, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("targeting.first");

  const id = await armTower(api, { type: "capacitor", tier: 1 });
  check.expectEq("a firing component defaults to the first priority", towerById(await snap(api), id).targeting, "first");

  const { t, la, lb } = await poseHeadTargets(api, "first");
  const toAdvanced = angDiff(t.heading, angleTo(t.cx, t.cy, la));
  const toFresh = angDiff(t.heading, angleTo(t.cx, t.cy, lb));
  check.expectLt("under first, the head aims at the unit furthest along (not the fresh one)", toAdvanced, toFresh);
  check.expectLt("...and closely tracks it", toAdvanced, 0.25);

  await liveClip(api);
  return check.verdict();
}
