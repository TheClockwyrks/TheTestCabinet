// Automated validation for the Slow sub-item `boss-immune`.
//
// The Macromass boss is immune to the Moderator slow — its speed is unchanged in the
// field. The check poses the boss in a Moderator's field, steps one tick, and confirms
// its slow factor is 1 and its speed equals its base speed.

import { coverAndSpawn, unitById, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("slow.boss-immune");

  const { unitId } = await coverAndSpawn(api, { kind: "moderator", type: "macromass" });
  await api.step(0.05);
  const u = unitById(await api.snapshot(), unitId);

  check.expectEq("the boss is immune to the slow (factor 1)", u.slow, 1);
  check.expectEq("its speed is its full base speed", u.speed, u.baseSpeed);

  await liveClip(api, 1000);
  return check.verdict();
}
