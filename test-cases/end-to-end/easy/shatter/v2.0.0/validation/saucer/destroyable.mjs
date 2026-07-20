// Automated validation for the Saucer item `destroyable`: the saucer can be shot down
// with a bullet, for points. A saucer is posed at rest clear of the star and a real
// bullet is fired into it; the real collision code must remove it and award its score.

import { newGame, SAUCER_SCORE, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("saucer.destroyable");

  await newGame(api);
  await api.call("setScore", 0);
  await api.call("spawnSaucer");
  await api.call("setSaucer", { x: 300, y: 300, vx: 0, vy: 0 });
  await api.call("addBullet", { x: 250, y: 300, vx: 860, vy: 0 });

  const r = await (async () => {
    for (let i = 0; i < 40; i += 1) {
      await api.step(0.01);
      if ((await api.snapshot()).saucer === null) return await api.snapshot();
    }
    return await api.snapshot();
  })();

  check.expectEq("a bullet shoots the saucer down", r.saucer, null);
  check.expectEq("shooting the saucer scores 200", r.score, SAUCER_SCORE);

  await api.call("spawnSaucer");
  await api.call("setSaucer", { x: 300, y: 300, vx: 0, vy: 0 });
  await api.call("addBullet", { x: 250, y: 300, vx: 860, vy: 0 });
  await liveClip(api, 700);
  return check.verdict();
}
