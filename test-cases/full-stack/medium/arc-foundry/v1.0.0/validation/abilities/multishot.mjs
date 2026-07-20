// Automated validation for abilities.multishot: a multishot combination tower fires at up to N
// distinct in-range targets per cadence, each a separate traveling projectile.
//
// A Fork Array (multishot 3) is assembled and three units released; in its first volley there
// must be projectiles homing on at least two distinct targets at once.

import { assembleCombo, spawnControlled, snap, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("abilities.multishot");

  const { comboId } = await assembleCombo(api, "forkarray", { seed: 1, charge: 400 });
  check.expectOk("a Fork Array was assembled", comboId != null);

  await spawnControlled(api, "mote", { count: 3 });
  const r = await stepUntil(api, (s) => new Set(s.projectiles.map((p) => p.targetId)).size >= 2, 0.5);
  check.expectOk("the multishot combo fired at multiple distinct targets at once", r.hit);

  const s = await snap(api);
  check.expectGe("multiple distinct targets were engaged in one cadence", new Set(s.projectiles.map((p) => p.targetId)).size, 2);

  await liveClip(api);
  return check.verdict();
}
