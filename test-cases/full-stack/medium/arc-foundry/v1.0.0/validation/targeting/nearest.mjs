// Automated validation for targeting.nearest: under `nearest` a firing component aims at the
// unit closest to it in straight-line distance.
//
// The advanced unit has moved along the leg and is nearer the entry-adjacent tower than the
// fresh unit at the Entry, so under `nearest` the head must aim at the advanced (nearer) one.

import { poseHeadTargets, angleTo, angDiff, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("targeting.nearest");

  const { t, la, lb } = await poseHeadTargets(api, "nearest");
  const dA = Math.hypot(la.x - t.cx, la.y - t.cy);
  const dB = Math.hypot(lb.x - t.cx, lb.y - t.cy);
  const nearer = dA <= dB ? la : lb;
  const farther = dA <= dB ? lb : la;
  check.expectLt(
    "under nearest, the head aims at the closer unit",
    angDiff(t.heading, angleTo(t.cx, t.cy, nearer)),
    angDiff(t.heading, angleTo(t.cx, t.cy, farther)),
  );

  await liveClip(api);
  return check.verdict();
}
