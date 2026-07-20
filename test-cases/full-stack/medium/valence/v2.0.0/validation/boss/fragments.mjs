// Automated validation for the Boss sub-item `fragments`.
//
// A worn-down Macromass fountains matter as it decays rather than merely draining a hit
// point bar: each decay step it crosses puts the next entry of its 55-step chain onto the
// path. The check drives the boss down a line of Impactor Cleavers — enough to break its
// containment pool and then crack the nucleus behind it — and watches the real matter
// list for the alpha (6-electron) and beta (2-electron) atoms the chain emits.

import { stepUntil, unitById, liveClip } from "../_helpers.mjs";
import { bossUnderFire } from "./_boss.mjs";

const MAX_CRACK_SECONDS = 120; // generous: game time on the manual clock, not wall clock

export default async function drive(api, ttc) {
  const check = ttc.checkOne("boss.fragments");

  const { bossId } = await bossUnderFire(api);
  const hp0 = unitById(await api.snapshot(), bossId).hp;

  let sawAlpha = false;
  let sawBeta = false;
  const r = await stepUntil(api, (s) => {
    for (const u of s.matter) {
      if (u.type === "atom") {
        if (u.electrons >= 6) sawAlpha = true;
        if (u.electrons === 2) sawBeta = true;
      }
    }
    return sawAlpha && sawBeta;
  }, MAX_CRACK_SECONDS, 0.05);

  check.expectOk("the boss sheds an alpha (6-electron) fragment as it decays", sawAlpha);
  check.expectOk("the boss sheds a beta (2-electron) fragment as it decays", sawBeta);
  const u = unitById(r.snap, bossId);
  check.expectOk("the boss is worn down under fire", u == null || u.hp < hp0);

  await liveClip(api, 1500);
  return check.verdict();
}
