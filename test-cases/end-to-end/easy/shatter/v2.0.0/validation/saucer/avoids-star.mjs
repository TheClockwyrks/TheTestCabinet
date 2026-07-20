// Automated validation for the Saucer item `avoids-star`: the saucer steers clear of the
// star and is never pulled into it. A saucer is posed just off the core; as the real sim
// runs it must steer away — its distance from the star grows and it never overlaps the
// core.

import { newGame, distToStar, CORE_R, SAUCER_R, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("saucer.avoids-star");

  await newGame(api);
  await api.call("spawnSaucer");
  await api.call("setSaucer", { x: 640, y: 430, vx: 0, vy: 0 }); // just below the core, inside the avoid radius
  const startD = distToStar((await api.snapshot()).saucer);

  let minD = startD;
  for (let i = 0; i < 40; i += 1) {
    await api.step(0.02); // 0.8 s (short of a weave reroll)
    minD = Math.min(minD, distToStar((await api.snapshot()).saucer));
  }
  const endD = distToStar((await api.snapshot()).saucer);

  check.expectGt("the saucer never overlaps the core", minD, CORE_R + SAUCER_R);
  check.expectGt("the saucer steers away from the star", endD, startD + 20);

  await api.call("setSaucer", { x: 640, y: 430, vx: 0, vy: 0 });
  await liveClip(api, 800);
  return check.verdict();
}
