// Automated validation for the Slow sub-item `heavy-resists`.
//
// A heavy in a Moderator field is slowed only partially — it resists to a higher speed
// than ordinary matter does. The check poses a heavy in a Moderator's field, steps one
// tick, and confirms its slow factor is the heavy resist value and clearly above the
// ordinary slow.

import { coverAndSpawn, unitById, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("slow.heavy-resists");

  const { unitId } = await coverAndSpawn(api, { kind: "moderator", type: "isotope" });
  await api.step(0.05);
  const u = unitById(await api.snapshot(), unitId);

  check.expectClose("a heavy resists the slow (~0.78x)", u.slow, 0.78, 0.04);
  check.expectGt("a heavy is slowed less than ordinary matter (which is ~0.55x)", u.slow, 0.55);

  await liveClip(api, 1000);
  return check.verdict();
}
