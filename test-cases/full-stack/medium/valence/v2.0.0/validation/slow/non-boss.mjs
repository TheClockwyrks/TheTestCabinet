// Automated validation for the Slow sub-item `non-boss`.
//
// A Moderator's aura slows ordinary matter to a fraction of its unslowed speed. The
// check poses an atom in a Moderator's field, steps one tick for the aura to apply, and
// reads the unit's slow factor and current speed.

import { coverAndSpawn, unitById, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("slow.non-boss");

  const { unitId } = await coverAndSpawn(api, { kind: "moderator", type: "atom", electrons: 3 });
  await api.step(0.05);
  const u = unitById(await api.snapshot(), unitId);

  check.expectClose("a Moderator slows ordinary matter to ~0.55x", u.slow, 0.55, 0.03);
  check.expectClose("its current speed is its base speed slowed", u.speed, u.baseSpeed * 0.55, u.baseSpeed * 0.06);

  await liveClip(api, 1000);
  return check.verdict();
}
