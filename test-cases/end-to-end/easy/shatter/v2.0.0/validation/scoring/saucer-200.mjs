// Automated validation for the Scoring item `saucer-200`: destroying the saucer scores
// 200. A saucer is posed at rest clear of the star and a real bullet is fired into it;
// the score is read back once it is destroyed.

import { newGame, SAUCER_SCORE, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("scoring.saucer-200");

  await newGame(api);
  await api.call("setScore", 0);
  await api.call("spawnSaucer");
  await api.call("setSaucer", { x: 300, y: 300, vx: 0, vy: 0 });
  await api.call("addBullet", { x: 250, y: 300, vx: 860, vy: 0 });

  const r = await (async () => {
    for (let i = 0; i < 40; i += 1) {
      await api.step(0.01);
      if ((await api.snapshot()).saucer === null) break;
    }
    return await api.snapshot();
  })();

  check.expectEq("the saucer is destroyed", r.saucer, null);
  check.expectEq("destroying the saucer scores 200", r.score, SAUCER_SCORE);

  await liveClip(api, 600);
  return check.verdict();
}
